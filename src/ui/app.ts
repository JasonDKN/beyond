import { Player } from '@/audio/player';
import { runPipeline } from '@/core/pipeline';
import { store } from '@/core/store';
import { ControlsView } from './controls';
import { clear, el } from './dom';
import { DropzoneView } from './dropzone';
import { InspectorView } from './inspector';
import type { AudioSource } from '@/core/types';
import { fingerprintBuffer, legacyKey } from '@/storage/fingerprint';
import {
  getTrack,
  getTrackAudio,
  legacySheet,
  saveTrack,
  saveTrackAudio,
} from '@/storage/library';
import { getSheet, setSheet } from '@/transcription/providers/lyrics';
import { LibraryView } from './library';
import { LyricsPanelView } from './lyricsPanel';
import { defaultModeFor, ModeSwitchView, savedModeFor, saveModeFor } from './modeSwitch';
import { ScoreView } from './score';
import { StaffView } from './staff';
import { StatusView } from './status';
import { SyllableGridView } from './syllableGrid';
import { TransportView } from './transport';

/**
 * Wiring.
 *
 * Every view is a plain object with an `element` and an `update(state)`. The
 * store emits one change event; each view decides for itself what that means.
 * No virtual DOM, no reactivity system — just one direction of flow.
 */
export function mountApp(root: HTMLElement): void {
  const player = new Player();

  const staff = new StaffView({
    onSeek: (seconds) => player.seek(seconds),
    onSelectWord: (lineIndex, wordIndex) => store.patch({ selected: { lineIndex, wordIndex } }),
  });

  const scoreView = new ScoreView({
    onSeek: (seconds) => player.seek(seconds),
    onSelectWord: (lineIndex, wordIndex) => store.patch({ selected: { lineIndex, wordIndex } }),
    // Scrolling by hand means you want to read. It stays paused until you say
    // otherwise — pressing Follow, or loading a different song.
    onUserScroll: () => {
      if (store.state.followScore) store.patch({ followScore: false });
    },
  });

  const inspector = new InspectorView();
  const controls = new ControlsView(store);
  const transport = new TransportView(
    player,
    (zoom) => staff.setZoom(zoom),
    () => store.patch({ followScore: true }),
  );
  const status = new StatusView();
  const grid = new SyllableGridView((seconds) => player.seek(seconds));
  const lyricsPanel = new LyricsPanelView(store, player, {
    onBuild: () => void buildAndStudy(),
  });

  let currentFile: File | null = null;

  /**
   * Identify the track, restore anything saved for it, and keep the audio.
   *
   * Runs between decoding and transcription, because the fingerprint needs the
   * decoded samples and the lyric sheet has to be in place before the provider
   * reads it.
   */
  const adoptTrack = async (audio: AudioSource): Promise<void> => {
    const id = fingerprintBuffer(audio.buffer);

    const saved = await getTrack(id);
    // Work saved before the library existed was keyed by file name. Carry it
    // over the first time we see the song, now that we know its fingerprint.
    const sheet =
      saved?.sheet ?? legacySheet(legacyKey(audio.name, audio.durationSec)) ?? null;

    if (sheet) {
      setSheet({ ...sheet, audioKey: id });
    } else {
      setSheet({
        language: store.state.inputLanguage === 'auto' ? 'ko' : store.state.inputLanguage,
        lines: [],
        audioKey: id,
      });
    }

    // Publish the id only now. The panel reloads its text when `trackId`
    // changes, so announcing the new track before its sheet is in place makes
    // it read the previous (or empty) one and never look again.
    store.patch({ trackId: id, ...(saved ? { mode: saved.mode } : {}) });

    // Record the track even when empty, so it appears in the library the
    // moment you start work rather than only once you press Build.
    await saveTrack({
      id,
      title: audio.name.replace(/\.[^.]+$/, ''),
      fileName: audio.name,
      durationSec: audio.durationSec,
      language: store.state.inputLanguage === 'auto' ? 'ko' : store.state.inputLanguage,
      mode: store.state.mode,
      sheet: getSheet(),
    });

    // Keep the recording so the track reopens without a file picker. Timings
    // are already safe at this point, so a full quota costs convenience only.
    if (currentFile && !saved?.hasAudio) {
      await saveTrackAudio(id, currentFile);
    }
    void library.refresh();
  };

  const openFile = (file: File): void => {
    currentFile = file;
    void runPipeline(store, file, { onAudioDecoded: adoptTrack });
  };

  const dropzone = new DropzoneView(openFile);

  const library = new LibraryView({
    onOpen: (track) => {
      void (async () => {
        const blob = await getTrackAudio(track.id);
        if (!blob) {
          // No stored recording — ask for the file, and the fingerprint will
          // reunite it with its timings.
          store.patch({
            notice: `${track.title}: the audio isn't stored. Choose the file and your timings will reattach.`,
          });
          return;
        }
        openFile(new File([blob], track.fileName, { type: blob.type || 'audio/mpeg' }));
      })();
    },
  });

  /**
   * Build the score and move to Learning.
   *
   * Pressing "Build the score" is the moment the job changes from timing to
   * practising, so the view changes with it — unless you have said otherwise
   * for this song, in which case your choice stands.
   */
  const buildAndStudy = async (): Promise<void> => {
    if (!currentFile) return;
    await runPipeline(store, currentFile, { onAudioDecoded: adoptTrack });
    if (store.state.status !== 'ready') return;
    const key = currentAudioKey();
    if (key && savedModeFor(key)) return;
    store.patch({ mode: 'learning', followScore: true });
  };

  const modeSwitch = new ModeSwitchView(store, (mode) => {
    // An explicit choice outranks the default, and is remembered for this song.
    const key = currentAudioKey();
    if (key) saveModeFor(key, mode);
    store.patch({ mode });
  });

  const scoreScroll = el(
    'div',
    { class: 'stage__score-scroll' },
    lyricsPanel.element,
    scoreView.element,
  );
  scoreView.attachScroller(scoreScroll);

  const stage = el(
    'main',
    { class: 'stage' },
    el(
      'section',
      { class: 'stage__staff' },
      el('div', { class: 'staff__frame' }, staff.element),
      transport.element,
      grid.element,
    ),
    el('section', { class: 'stage__score' }, scoreScroll, inspector.element),
  );

  clear(root);
  root.append(
    masthead(controls, modeSwitch),
    el('div', { class: 'opening' }, dropzone.element, library.element),
    stage,
    status.element,
  );
  void library.refresh();

  // --- state → views -------------------------------------------------------
  const views = [
    dropzone,
    staff,
    scoreView,
    inspector,
    controls,
    transport,
    status,
    grid,
    lyricsPanel,
    modeSwitch,
    library,
  ];
  store.events.on('change', (state) => {
    for (const view of views) view.update(state);
    document.body.classList.toggle('has-audio', Boolean(state.audio));
    // One class drives the whole layout switch; the CSS does the rest.
    document.body.classList.toggle('mode-annotation', state.mode === 'annotation');
    document.body.classList.toggle('mode-learning', state.mode === 'learning');
  });

  // --- choosing the mode ---------------------------------------------------
  //
  // Open on the job actually in front of you: still lines to time → Annotation;
  // everything timed and a score built → Learning. An explicit choice for this
  // song always wins.
  let lastAudioKey = '';

  /** The fingerprint, so a remembered mode follows the song, not the filename. */
  function currentAudioKey(): string {
    return store.state.trackId ?? '';
  }

  function pickMode(): void {
    const key = currentAudioKey();
    if (!key) return;

    const chosen = savedModeFor(key);
    const sheet = getSheet();
    const suggested = defaultModeFor({
      hasScore: store.state.score !== null,
      totalLines: sheet.lines.length,
      timedLines: sheet.lines.filter((line) => line.startSec !== null).length,
    });
    const next = chosen ?? suggested;
    if (next !== store.state.mode) store.patch({ mode: next });
  }

  store.events.on('change', (state) => {
    const key = currentAudioKey();
    // A different song: re-evaluate the mode and start following again.
    if (key && key !== lastAudioKey) {
      lastAudioKey = key;
      if (!state.followScore) store.patch({ followScore: true });
      pickMode();
    }
  });

  // --- player → state ------------------------------------------------------
  player.events.on('tick', (time) => store.patch({ currentTime: time }));
  player.events.on('seek', (time) => store.patch({ currentTime: time }));
  player.events.on('play', () => store.patch({ playing: true }));
  player.events.on('pause', () => store.patch({ playing: false }));
  player.events.on('ended', () => store.patch({ playing: false }));
  player.events.on('loopchange', (loop) => store.patch({ loop }));

  store.events.on('change', (state) => {
    if (state.audio && player.source !== state.audio) {
      player.load(state.audio);
      scoreView.follow = true;
    }
  });

  // --- layout --------------------------------------------------------------
  const resize = (): void => staff.resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(staff.element.parentElement ?? staff.element);
  requestAnimationFrame(resize);

  // --- keyboard ------------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        player.toggle();
        break;
      case 'ArrowLeft':
        player.nudge(event.shiftKey ? -10 : -3);
        break;
      case 'ArrowRight':
        player.nudge(event.shiftKey ? 10 : 3);
        break;
      case 'Escape':
        store.patch({ selected: null });
        break;
      default:
        break;
    }
  });

  store.patch({});
}

function masthead(controls: ControlsView, modeSwitch: ModeSwitchView): HTMLElement {
  return el(
    'header',
    { class: 'masthead' },
    el(
      'div',
      { class: 'masthead__brand' },
      el('span', { class: 'wordmark' }, 'Beyond'),
      el(
        'span',
        { class: 'wordmark__ipa', lang: 'und-fonipa', 'aria-hidden': 'true' },
        'bɪˈjɑnd',
      ),
    ),
    modeSwitch.element,
    controls.element,
  );
}
