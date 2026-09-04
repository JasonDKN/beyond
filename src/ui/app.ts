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
  type TrackRecord,
} from '@/storage/library';
import {
  adoptProject,
  canWriteFiles,
  embedAudio,
  EmptyWriteError,
  MAX_EMBED_BYTES,
  parseProject,
  pickOpenHandle,
  pickSaveHandle,
  projectFileName,
  serializeProject,
  writeHandle,
} from '@/storage/project';
import { download } from '@/export';
import { getSheet, setSheet } from '@/transcription/providers/lyrics';
import { ACCEPT_ATTRIBUTE } from '@/audio/decoder';
import { HelpView } from './help';
import { TipsView } from './tips';
import { LibraryView } from './library';
import { PracticeView } from './practice';
import { SectionBarView } from './sectionBar';
import { TrackBarView } from './trackBar';
import { LyricsPanelView } from './lyricsPanel';
import { defaultModeFor, ModeSwitchView, savedModeFor, saveModeFor } from './modeSwitch';
import { ScoreView } from './score';
import { StaffView } from './staff';
import { StatusView } from './status';
import { SyllableGridView } from './syllableGrid';
import { TransportView } from './transport';
import { setFaviconPlaying } from './favicon';
import {
  FullscreenView,
  loadFullscreenLayout,
  saveFullscreenLayout,
} from './fullscreen';
import { loadHiddenWaveforms, saveHiddenWaveforms, toggleWaveform } from './waveform';

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
    // Scrolling deliberately away means you want to read somewhere else. It
    // stays paused until the song reaches you again — see follow.ts for what
    // separates a decision from a nudge.
    onFollowPause: () => {
      if (store.state.followScore) store.patch({ followScore: false });
    },
    onFollowResume: () => {
      if (!store.state.followScore) store.patch({ followScore: true });
    },
  });

  const inspector = new InspectorView();
  const controls = new ControlsView(store);
  const transport = new TransportView(
    player,
    (zoom) => staff.setZoom(zoom),
    () => store.patch({ followScore: true }),
    () => {
      const next = toggleWaveform(store.state.waveformHidden, store.state.mode);
      saveHiddenWaveforms(next);
      store.patch({ waveformHidden: next });
    },
    (delta) => stepLine(delta),
    () => setFullscreen(!store.state.fullscreen),
  );

  const fullscreen = new FullscreenView(store, player, {
    onExit: () => setFullscreen(false),
    onStepLine: (delta) => stepLine(delta),
    onSetLayout: (layout) => {
      saveFullscreenLayout(layout);
      store.patch({ fullscreenLayout: layout });
    },
  });

  /**
   * In and out of fullscreen, in one place.
   *
   * Order matters going in: the element has to be on screen before the browser
   * will hand it the display, so the state changes first and the request
   * follows. Both callers — the button and the keys — go through here so the
   * two can never drift apart.
   */
  const setFullscreen = (on: boolean): void => {
    if (on && !store.state.score) return;
    store.patch({ fullscreen: on });
    void (on ? fullscreen.enter() : fullscreen.leave());
  };

  /**
   * Jump to the start of the line before or after the one playing.
   *
   * A line is the unit you practise in, so it is the unit worth stepping by —
   * five seconds lands you in the middle of a phrase, which is exactly where
   * you cannot start singing from.
   *
   * "The line playing" is the last one to have started, so stepping back from
   * partway through a line goes to the line before it rather than restarting
   * the current one. Predictable beats clever: Back 5 is right there for
   * hearing the run-up again.
   */
  const stepLine = (delta: number): void => {
    const lines = store.state.score?.lines ?? [];
    if (lines.length === 0) return;
    const now = player.currentTime;
    let index = -1;
    for (const [i, line] of lines.entries()) {
      if (now + 0.05 >= line.startSec) index = i;
    }
    const target = Math.min(Math.max(index + delta, 0), lines.length - 1);
    const line = lines[target];
    if (line) player.seek(line.startSec);
  };
  const status = new StatusView();
  const grid = new SyllableGridView((seconds) => player.seek(seconds));

  // Structure lives with the transport, not inside a mode: all three views
  // need to jump around the song.
  const sectionBar = new SectionBarView({
    onSeek: (seconds) => player.seek(seconds),
    onLoop: (start, end) => player.setLoop(start, end),
    onPlay: () => void player.play(),
  });

  const tips = new TipsView();
  const help = new HelpView(() => help.setOpen(false), tips);

  // Remembers the level to put back, so ducking the backing track under a
  // take never leaves the volume slider somewhere the user did not set it.
  let volumeBeforeDuck: number | null = null;

  const practice = new PracticeView(store, {
    onSeek: (seconds) => player.seek(seconds),
    onPlay: () => void player.play(),
    onPause: () => player.pause(),
    getPosition: () => player.currentTime,
    setBackingLevel: (level) => {
      if (level === null) {
        if (volumeBeforeDuck !== null) player.volume = volumeBeforeDuck;
        volumeBeforeDuck = null;
        return;
      }
      volumeBeforeDuck ??= player.volume;
      player.volume = volumeBeforeDuck * level;
    },
  });
  const lyricsPanel = new LyricsPanelView(store, player, {
    onBuild: () => void buildAndStudy(),
    onLyricsReady: () => {
      const key = currentAudioKey();
      if (key) saveModeFor(key, 'beatmap');
      store.patch({ mode: 'beatmap' });
    },
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
    // Opening anything dismisses the drawer, whichever route got us here —
    // the dropzone, the toolbar, or a drop onto the window. Leaving that to
    // each call site meant one path forgot and the drawer sat over the
    // workspace swallowing clicks.
    store.patch({ libraryOpen: false });
    void runPipeline(store, file, { onAudioDecoded: adoptTrack });
  };

  const dropzone = new DropzoneView({
    onFile: openFile,
    // The way in on a device that has never seen this song: a save file with
    // the song inside brings the audio too, so nothing is missing.
    onProjectFile: (file) => openProjectFile(file, null),
  });

  /**
   * Write the current track's work before leaving it.
   *
   * Every tap already saves as it happens, so this is usually a no-op — but
   * "usually" is not the standard for the moment you walk away from an hour of
   * timing. Switching waits for a confirmed write.
   */
  const flushCurrentTrack = async (): Promise<void> => {
    const { trackId, audio, mode, inputLanguage } = store.state;
    if (!trackId || !audio) return;
    store.patch({ saveState: 'saving' });
    await saveTrack({
      id: trackId,
      title: audio.name.replace(/\.[^.]+$/, ''),
      fileName: audio.name,
      durationSec: audio.durationSec,
      language: inputLanguage === 'auto' ? 'ko' : inputLanguage,
      mode,
      sheet: getSheet(),
    });
    store.patch({ saveState: 'saved', savedAt: Date.now() });
  };

  const openSavedTrack = (track: { id: string; title: string; fileName: string }): void => {
    void (async () => {
      await flushCurrentTrack();
      store.patch({ libraryOpen: false });

      const blob = await getTrackAudio(track.id);
      if (!blob) {
        // No stored recording — ask for the file, and the fingerprint will
        // reunite it with its timings.
        store.patch({
          notice: `${track.title}: the audio isn't stored. Choose the file and your timings will reattach.`,
        });
        pickFile();
        return;
      }
      openFile(new File([blob], track.fileName, { type: blob.type || 'audio/mpeg' }));
    })();
  };

  /** A file picker that works once a song is already open. */
  const fileInput = el('input', {
    type: 'file',
    // Distinct from the dropzone's own input, so the two are never confused.
    class: 'visually-hidden',
    'data-role': 'open-track',
    accept: ACCEPT_ATTRIBUTE,
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      // Reset, so choosing the same file twice still fires a change.
      input.value = '';
      if (!file) return;
      void (async () => {
        await flushCurrentTrack();
        store.patch({ libraryOpen: false });
        openFile(file);
      })();
    },
  }) as HTMLInputElement;

  const pickFile = (): void => fileInput.click();

  const library = new LibraryView({ onOpen: openSavedTrack });

  const drawer = new LibraryView(
    {
      onOpen: openSavedTrack,
      onClose: () => store.patch({ libraryOpen: false }),
      onOpenFile: pickFile,
      // Deferred: `openProject` is declared below, and only ever invoked on a
      // click, long after this object is built.
      onOpenProject: () => openProject(),
    },
    'drawer',
  );

  /**
   * The project file this track writes to, if one has been chosen.
   *
   * Held per track: switching songs drops the link, because a project file
   * belongs to one song and silently overwriting it with another would be a
   * spectacular way to lose work.
   */
  let projectHandle: FileSystemFileHandle | null = null;
  let projectTrackId: string | null = null;
  let projectWriteTimer = 0;

  /**
   * One write to the save file at a time, in order.
   *
   * Two things write to it: pressing Save, and the debounced mirror that
   * follows every autosave. Nothing stopped them overlapping, and overlapping
   * is genuinely destructive here — `createWritable` truncates the target the
   * moment it is called, so a second write opening while the first is still
   * streaming leaves the two of them interleaving into one file. The visible
   * result is a save that reports success and leaves nothing behind, which is
   * exactly the symptom, and it needs no sync client to explain it: just a
   * write that took longer than the 800 ms debounce.
   *
   * Chaining them costs nothing — the second write is writing the same record
   * a moment later anyway — and makes the failure impossible rather than
   * merely unlikely.
   */
  let writeQueue: Promise<unknown> = Promise.resolve();

  const queueWrite = <T,>(job: () => Promise<T>): Promise<T> => {
    // `then(job, job)` so a rejected predecessor still lets the next one run.
    const next = writeQueue.then(job, job);
    writeQueue = next.catch(() => undefined);
    return next;
  };

  const currentRecord = async (): Promise<TrackRecord | null> => {
    const id = store.state.trackId;
    return id ? getTrack(id) : null;
  };

  /**
   * The encoded song, kept for as long as the song is open.
   *
   * A save file carries the audio, and the audio never changes for a given
   * track — so base64-encoding it on every write would be redoing identical
   * work several megabytes at a time, on the same path that runs after every
   * tap. Encode once per track and hold the string.
   */
  let encodedAudio: { trackId: string; audio: Awaited<ReturnType<typeof embedAudio>> } | null =
    null;

  /**
   * What goes in the save file: the work, and the song with it.
   *
   * There used to be two kinds of file — one with the song and one without —
   * and that was a distinction nobody should have had to learn. It also had a
   * trap in it: the small one is useless on a device that has never seen the
   * song, which is exactly the device you are most likely to be opening it on.
   * So there is one file now, and it is the complete one.
   */
  const projectContents = async (record: TrackRecord): Promise<string> => {
    if (encodedAudio?.trackId !== record.id) {
      /*
       * Ask the audio store, not the record's flag.
       *
       * `hasAudio` is a denormalised copy kept on the track record, and it is
       * only ever set by the call that stores a blob — so any route that puts
       * audio in the store without going through that call, or any record
       * rebuilt from a backup, leaves it false while the song sits there. The
       * flag is fine for drawing a badge in the drawer. Deciding whether the
       * song goes into somebody's save file is not a job for a cache that can
       * drift: it made Save As quietly write a file without the song while the
       * drawer, which asks the store directly, wrote the complete one.
       */
      const blob = await getTrackAudio(record.id);
      if (!blob || blob.size > MAX_EMBED_BYTES) {
        // No stored audio, or more than a tab should hold three copies of.
        // The work still saves; it just travels without the song.
        return serializeProject(record);
      }
      encodedAudio = { trackId: record.id, audio: await embedAudio(blob, record.fileName) };
    }
    return serializeProject(record, encodedAudio.audio);
  };

  /**
   * Write the current track to its linked file. Silent — no picker.
   *
   * Returns whether the work is on disk, because a save that quietly did
   * nothing is the one outcome worth interrupting somebody over.
   */
  const writeProjectFile = (): Promise<boolean> =>
    queueWrite(async () => {
      if (!projectHandle || projectTrackId !== store.state.trackId) return false;
      const record = await currentRecord();
      if (!record) return false;
      const contents = await projectContents(record);
      try {
        await writeHandle(projectHandle, contents);
        return true;
      } catch (error) {
        const name = projectHandle.name;
        // The file may have been moved, permission withdrawn, or the write may
        // have reported success and produced nothing.
        projectHandle = null;
        projectTrackId = null;
        trackBar.setLinkedFile(null);

        if (error instanceof EmptyWriteError) {
          /*
           * Do not leave with nothing.
           *
           * The file system route just produced an empty file, so take the
           * other one: a plain download goes through the browser's own
           * machinery and never touches the target directly. It costs a trip
           * to the Downloads folder and it means the work exists somewhere.
           */
          download(projectFileName(record.title), contents, 'application/json');
          store.patch({
            notice:
              `This browser can’t write to ${name} — it produced an empty file, ` +
              'so your work has been downloaded instead. Saving will use downloads ' +
              'from now on, so you will only be asked once.',
          });
          return false;
        }

        store.patch({ notice: `Could not write ${name}. Use Save As… to pick a new file.` });
        return false;
      }
    });

  /**
   * Save, and Save As.
   *
   * Save writes to the file this track already lives in and says nothing;
   * that is the whole point of having saved once. Only when there is no file
   * yet does it have to ask, which is the one case where Save and Save As
   * mean the same thing.
   */
  const saveToFile = (askWhere: boolean): void => {
    void (async () => {
      const record = await currentRecord();
      if (!record) return;

      // Already has a home, and we were not asked to move it.
      if (!askWhere && projectHandle && projectTrackId === record.id) {
        const name = projectHandle.name;
        // Only say it saved if it saved. writeProjectFile has already
        // explained itself if it did not.
        if (await writeProjectFile()) store.patch({ notice: `Saved to ${name}.` });
        return;
      }

      if (!canWriteFiles()) {
        // Firefox and Safari cannot write to a picked file, so fall back to a
        // plain download. Same data, one more step.
        download(projectFileName(record.title), await projectContents(record), 'application/json');
        return;
      }

      const handle = await pickSaveHandle(projectFileName(record.title));
      if (!handle) return;
      projectHandle = handle;
      projectTrackId = record.id;
      trackBar.setLinkedFile(handle.name);
      if (await writeProjectFile()) {
        store.patch({ notice: `Saving to ${handle.name} from now on.` });
      }
    })();
  };

  /** Open a project file and load the song it describes. */
  const openProjectFile = (file: File, handle: FileSystemFileHandle | null): void => {
    void (async () => {
      // Parse before touching anything, so a bad file changes nothing.
      let parsed;
      try {
        parsed = parseProject(await file.text());
      } catch (error) {
        store.patch({
          notice: error instanceof Error ? error.message : 'That project could not be opened.',
        });
        return;
      }

      // Save whatever is open *first*. The project may describe the very song
      // already loaded — same audio, same fingerprint — and flushing after
      // adopting would write the current sheet straight over the file we were
      // asked to open.
      await flushCurrentTrack();
      const adopted = await adoptProject(parsed.track);
      store.patch({ libraryOpen: false });
      projectHandle = handle;
      projectTrackId = adopted.id;
      trackBar.setLinkedFile(handle?.name ?? null);

      // A travel pack brought the song with it. Keep it, so this device never
      // has to ask for the file again — which is the entire point of a pack on
      // a device that has never seen the music.
      if (parsed.audio) {
        await saveTrackAudio(adopted.id, parsed.audio);
        openFile(
          new File([parsed.audio], parsed.audioFileName ?? adopted.fileName, {
            type: parsed.audio.type || 'audio/mpeg',
          }),
        );
        return;
      }

      const blob = await getTrackAudio(adopted.id);
      if (blob) {
        openFile(new File([blob], adopted.fileName, { type: blob.type || 'audio/mpeg' }));
        return;
      }
      // First time on this machine: the audio is not cached yet. Ask once —
      // the fingerprint will reattach it to the work we just loaded.
      store.patch({
        notice: `Opened ${adopted.title}. Choose its audio file and your timings will reattach.`,
      });
      pickFile();
    })();
  };

  const projectInput = el('input', {
    type: 'file',
    class: 'visually-hidden',
    'data-role': 'open-project',
    accept: '.json,application/json',
    onchange: (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) openProjectFile(file, null);
    },
  }) as HTMLInputElement;

  const openProject = (): void => {
    void (async () => {
      if (!canWriteFiles()) {
        projectInput.click();
        return;
      }
      const handle = await pickOpenHandle();
      if (!handle) return;
      openProjectFile(await handle.getFile(), handle);
    })();
  };

  const trackBar = new TrackBarView({
    onToggleLibrary: () => {
      const opening = !store.state.libraryOpen;
      store.patch({ libraryOpen: opening });
      if (opening) void drawer.refresh();
    },
    onOpenFile: pickFile,
    onSaveToFile: () => saveToFile(false),
    onSaveAs: () => saveToFile(true),
    onToggleHelp: () => help.setOpen(!help.isOpen),
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
      sectionBar.element,
      transport.element,
      grid.element,
    ),
    el('section', { class: 'stage__score' }, scoreScroll, inspector.element),
    practice.element,
  );

  clear(root);
  root.append(
    masthead(controls, modeSwitch, trackBar),
    el('div', { class: 'opening' }, dropzone.element, library.element),
    stage,
    drawer.element,
    fullscreen.element,
    help.element,
    tips.element,
    fileInput,
    projectInput,
    status.element,
  );

  // Mirror every stored save into the linked save file, debounced so a
  // burst of taps writes once rather than forty times.
  store.events.on('change', (state) => {
    if (state.saveState !== 'saved' || !projectHandle) return;
    clearTimeout(projectWriteTimer);
    // Longer than it was, because the file now carries the song and is
    // megabytes rather than kilobytes. A burst of taps should settle into one
    // write, not a queue of them — and nothing is at risk in the meantime,
    // since every tap is already safe in the browser's own storage.
    projectWriteTimer = window.setTimeout(() => void writeProjectFile(), 2500);
  });

  // Changing songs drops the link. A project file belongs to one song, and
  // quietly overwriting it with a different one would be a fine way to lose
  // an evening's work.
  store.events.on('change', (state) => {
    if (projectTrackId && state.trackId && state.trackId !== projectTrackId) {
      projectHandle = null;
      projectTrackId = null;
      trackBar.setLinkedFile(null);
    }
    // Let several megabytes of encoded song go when its song does.
    if (encodedAudio && state.trackId && state.trackId !== encodedAudio.trackId) {
      encodedAudio = null;
    }
  });
  // Restored before the first render, so a folded waveform never flashes into
  // view on the way to being hidden.
  store.patch({
    waveformHidden: loadHiddenWaveforms(),
    fullscreenLayout: loadFullscreenLayout(),
  });

  /*
   * The browser can leave fullscreen without asking us.
   *
   * Esc, the window controls, switching apps on a phone — all of them exit
   * without going through the button, and if the state did not follow, the app
   * would sit there drawing a fullscreen overlay across a window that is no
   * longer fullscreen. So the browser's opinion wins.
   */
  document.addEventListener('fullscreenchange', () => {
    const real = document.fullscreenElement === fullscreen.element;
    if (!real && store.state.fullscreen) store.patch({ fullscreen: false });
  });

  void library.refresh();
  void drawer.refresh();

  // Clicking the backdrop or pressing Escape closes the drawer.
  drawer.element.addEventListener('pointerdown', (event) => {
    if (event.target === drawer.element) store.patch({ libraryOpen: false });
  });

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
    drawer,
    trackBar,
    practice,
    sectionBar,
    help,
    fullscreen,
  ];
  // The sheet lives outside the store, so mirror the one fact the mode switch
  // needs before the views draw themselves.
  store.events.on('change', (state) => {
    const hasLyrics = getSheet().lines.length > 0;
    if (hasLyrics !== state.hasLyrics) {
      store.patch({ hasLyrics });
      return;
    }
    for (const view of views) view.update(state);
    document.body.classList.toggle('has-audio', Boolean(state.audio));
    // One class drives the whole layout switch; the CSS does the rest.
    document.body.classList.toggle('mode-setup', state.mode === 'setup');
    document.body.classList.toggle('mode-beatmap', state.mode === 'beatmap');
    document.body.classList.toggle('mode-learning', state.mode === 'learning');
    document.body.classList.toggle('mode-practice', state.mode === 'practice');
    // The mark in the masthead breathes while there is work in flight.
    document.body.classList.toggle('is-working', state.status === 'working');
    // …and the one in the tab flips while a song is running, so a browser full
    // of tabs still says which of them is the one making noise.
    setFaviconPlaying(state.playing);
    // Folded per view, so the class has to be recomputed whenever either the
    // view or the preference changes — which is what this render already is.
    document.body.classList.toggle(
      'waveform-hidden',
      state.waveformHidden.includes(state.mode),
    );
  });

  // Leaving Practice releases the microphone, so the browser stops showing a
  // recording indicator on a tab that is no longer listening.
  let wasPractising = false;
  store.events.on('change', (state) => {
    const practising = state.mode === 'practice';
    if (wasPractising && !practising) practice.release();
    wasPractising = practising;
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
  const resize = (): void => {
    staff.resize();
    // Rotating a phone changes which way the words have to fit.
    fullscreen.resize();
  };
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(staff.element.parentElement ?? staff.element);
  requestAnimationFrame(resize);

  // --- keyboard ------------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    // Escape is the way out of anything, including out of a field. Gating it
    // behind the same check as the letter keys meant that focusing a control
    // inside a panel made Escape stop closing that panel.
    if (event.key === 'Escape') {
      if (help.isOpen) help.setOpen(false);
      else if (store.state.libraryOpen) store.patch({ libraryOpen: false });
      // The browser exits fullscreen on Escape by itself; this is the state
      // catching up in the case where it did not (an unfullscreened overlay
      // filling the page still wants Escape to close it).
      else if (store.state.fullscreen) setFullscreen(false);
      else store.patch({ selected: null });
      return;
    }
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    /*
     * F, and F2 beside it.
     *
     * F is what a video player has taught everyone to press, and it costs
     * nothing here — Beyond's other letters are T, R and W, all in Beatmap. F2
     * exists because a function key is the one thing that still works when the
     * page has taken the letters, and it is the row people reach for when they
     * are looking for a mode rather than typing.
     */
    if (event.key === 'f' || event.key === 'F' || event.key === 'F2') {
      event.preventDefault();
      setFullscreen(!store.state.fullscreen);
      return;
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        player.toggle();
        break;
      case 'ArrowLeft':
        player.nudge(event.shiftKey ? -10 : -3);
        break;
      // Comma and full stop, which sit next to each other and are free — the
      // arrows already nudge by seconds and the brackets belong to the loop.
      case ',':
        stepLine(-1);
        break;
      case '.':
        stepLine(1);
        break;
      case 'ArrowRight':
        player.nudge(event.shiftKey ? 10 : 3);
        break;
      case '?':
        help.setOpen(!help.isOpen);
        break;
      default:
        break;
    }
  });

  store.patch({});
}

function masthead(
  controls: ControlsView,
  modeSwitch: ModeSwitchView,
  trackBar: TrackBarView,
): HTMLElement {
  return el(
    'header',
    { class: 'masthead' },
    el(
      'div',
      { class: 'masthead__brand' },
      /*
       * The mark, where the app says its own name.
       *
       * The same schwa as the tab, the home screen and the taskbar — a logo is
       * only a logo when it is the same thing in every place you meet it, and
       * this corner is the one place inside the app where Beyond speaks as
       * itself rather than about a song.
       *
       * It is also the activity light: it breathes while the pipeline works,
       * so the thing that identifies the app is the thing that tells you it is
       * busy. One element, two jobs, no spinner to invent.
       *
       * Hidden from screen readers because it is decoration here — the word
       * beside it already says Beyond, and a reader announcing "schwa" would
       * be reading the furniture.
       */
      el('span', { class: 'wordmark__mark', lang: 'und-fonipa', 'aria-hidden': 'true' }, 'ə'),
      el('span', { class: 'wordmark' }, 'Beyond'),
      el(
        'span',
        { class: 'wordmark__ipa', lang: 'und-fonipa', 'aria-hidden': 'true' },
        'bɪˈjɑnd',
      ),
    ),
    modeSwitch.element,
    trackBar.element,
    controls.element,
  );
}
