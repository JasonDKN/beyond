import type { Player } from '@/audio/player';
import type { State } from '@/core/store';
import { el, formatClock, ICONS, svgIcon } from './dom';

/** Playback controls. Deliberately few: play, scrub, slow down, zoom in. */
export class TransportView {
  readonly element: HTMLElement;

  #player: Player;
  #playButton: HTMLButtonElement;
  #clock: HTMLElement;
  #rate: HTMLInputElement;
  #rateReadout: HTMLButtonElement;
  #zoom: HTMLInputElement;
  #onZoom: (zoom: number) => void;
  #loopA: HTMLButtonElement;
  #loopB: HTMLButtonElement;
  #loopClear: HTMLButtonElement;
  #pendingA: number | null = null;
  #volume: HTMLInputElement;
  #volumeIcon: HTMLButtonElement;
  /** Level to restore when unmuting. */
  #lastAudibleVolume = 1;
  #followButton: HTMLButtonElement;
  #onResumeFollow: () => void;
  #waveButton: HTMLButtonElement;

  constructor(
    player: Player,
    onZoom: (zoom: number) => void,
    onResumeFollow: () => void,
    onToggleWaveform: () => void,
  ) {
    this.#player = player;
    this.#onZoom = onZoom;
    this.#onResumeFollow = onResumeFollow;

    /*
     * Fold the waveform away.
     *
     * It belongs in Beatmap, where you are aiming at a vocal you can watch
     * approaching. In Learning it competes with the words for the same height,
     * and the words are what you came for. Per view, so the answer can differ
     * between them — and the parts of the song stay put either way, because
     * jumping to the chorus is not what anyone is trying to get rid of.
     */
    this.#waveButton = el(
      'button',
      {
        class: 'transport__wave',
        type: 'button',
        onclick: () => onToggleWaveform(),
      },
      '〜',
    ) as HTMLButtonElement;

    // Follow-along, made visible. The old behaviour switched itself off
    // silently when you clicked a word, which is why it seemed to work only
    // sometimes. Now it takes a deliberate scroll away to stop it, this button
    // lights up to say so, and it hands itself back when the song catches up.
    this.#followButton = el(
      'button',
      {
        class: 'transport__follow',
        type: 'button',
        'data-tip':
          'Scroll the score to keep up with the music\nScroll away to read elsewhere — it resumes on its own\nwhen the song reaches you again',
        onclick: () => this.#onResumeFollow(),
      },
      'Follow',
    ) as HTMLButtonElement;

    this.#loopA = el(
      'button',
      {
        class: 'transport__loop-button',
        type: 'button',
        'data-tip': 'Set the loop start here  [',
        onclick: () => {
          this.#pendingA = this.#player.currentTime;
          this.#loopA.classList.add('is-set');
        },
      },
      'A',
    ) as HTMLButtonElement;

    this.#loopB = el(
      'button',
      {
        class: 'transport__loop-button',
        type: 'button',
        'data-tip': 'Set the loop end here and start looping  ]',
        onclick: () => this.#player.setLoop(this.#pendingA ?? 0, this.#player.currentTime),
      },
      'B',
    ) as HTMLButtonElement;

    this.#loopClear = el(
      'button',
      {
        class: 'transport__loop-button transport__loop-button--clear',
        type: 'button',
        'data-tip': 'Clear the loop  \\',
        onclick: () => {
          this.#player.clearLoop();
          this.#pendingA = null;
          this.#loopA.classList.remove('is-set');
        },
      },
      '✕',
    ) as HTMLButtonElement;

    this.#playButton = el('button', {
      class: 'transport__play',
      type: 'button',
      'aria-label': 'Play',
      onclick: () => this.#player.toggle(),
    });
    this.#playButton.appendChild(svgIcon(ICONS.play, 'Play'));

    this.#clock = el('div', { class: 'transport__clock' }, '0:00 / 0:00');

    /*
     * Speed, continuously.
     *
     * A handful of preset rates is fine for skimming and wrong for learning to
     * sing something: the speed you can just about keep up with is a specific
     * number, it sits between whatever two presets you were offered, and it
     * moves as you get better. So this is a slider down to the hundredth, and
     * it stops at 1× because nobody learning a song wants it faster than the
     * record.
     */
    this.#rateReadout = el(
      'button',
      {
        class: 'transport__rate-value',
        type: 'button',
        'data-tip': 'Back to full speed',
        'aria-label': 'Reset speed to 1×',
        onclick: () => this.#setRate(1),
      },
      '1.00×',
    ) as HTMLButtonElement;

    this.#rate = el('input', {
      class: 'transport__rate',
      type: 'range',
      min: String(MIN_RATE),
      max: String(MAX_RATE),
      step: '0.01',
      value: '1',
      'aria-label': 'Playback speed',
      // Arrow keys move it by one hundredth, which is the whole point of the
      // range — the global nudge shortcuts ignore a focused input.
      oninput: () => this.#setRate(Number(this.#rate.value)),
    }) as HTMLInputElement;

    // Volume. Stored across sessions, because the level that suits a quiet
    // vocal on headphones is not the one that suits laptop speakers, and
    // resetting it on every reload gets old fast.
    const savedVolume = readSavedVolume();
    this.#player.volume = savedVolume;

    this.#volume = el('input', {
      class: 'transport__volume',
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: String(savedVolume),
      'aria-label': 'Volume',
      oninput: () => {
        const level = Number(this.#volume.value);
        this.#player.volume = level;
        this.#volumeIcon.classList.toggle('is-muted', level === 0);
        saveVolume(level);
      },
    }) as HTMLInputElement;

    this.#volumeIcon = el(
      'button',
      {
        class: 'transport__mute',
        type: 'button',
        'data-tip': 'Mute / unmute',
        'aria-label': 'Mute or unmute',
        onclick: () => this.#toggleMute(),
      },
      '🔊',
    ) as HTMLButtonElement;
    this.#volumeIcon.classList.toggle('is-muted', savedVolume === 0);

    this.#zoom = el('input', {
      class: 'transport__zoom',
      type: 'range',
      min: '1',
      max: '16',
      step: '0.5',
      value: '1',
      'aria-label': 'Zoom the staff',
      oninput: () => this.#onZoom(Number(this.#zoom.value)),
    }) as HTMLInputElement;

    this.element = el(
      'div',
      { class: 'transport' },
      el(
        'div',
        { class: 'transport__group' },
        iconButton(ICONS.back, 'Back 5 seconds', () => this.#player.nudge(-5)),
        this.#playButton,
        iconButton(ICONS.forward, 'Forward 5 seconds', () => this.#player.nudge(5)),
      ),
      this.#clock,
      el(
        'div',
        { class: 'transport__group transport__loop' },
        this.#loopA,
        this.#loopB,
        this.#loopClear,
      ),
      this.#followButton,
      el(
        'div',
        { class: 'transport__group transport__group--right' },
        el('span', { class: 'transport__volume-group' }, this.#volumeIcon, this.#volume),
        el(
          'label',
          { class: 'transport__label transport__label--rate' },
          'Speed',
          this.#rate,
          this.#rateReadout,
        ),
        el('label', { class: 'transport__label' }, 'Zoom', this.#zoom),
        this.#waveButton,
      ),
    );

    this.#bindLoopKeys();
  }

  #toggleMute(): void {
    const current = this.#player.volume;
    if (current > 0) {
      this.#lastAudibleVolume = current;
      this.#setVolume(0);
    } else {
      this.#setVolume(this.#lastAudibleVolume || 1);
    }
  }

  #setVolume(level: number): void {
    this.#player.volume = level;
    this.#volume.value = String(level);
    this.#volumeIcon.classList.toggle('is-muted', level === 0);
    saveVolume(level);
  }

  /**
   * A–B loop.
   *
   * Set A at the start of a phrase, B at the end, and it repeats until you can
   * do it. This and the speed control are the two things that actually get a
   * hard passage into your mouth; everything else on this bar is convenience.
   */
  #bindLoopKeys(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === '[') {
        this.#pendingA = this.#player.currentTime;
        this.#loopA.classList.add('is-set');
      } else if (event.key === ']') {
        this.#player.setLoop(this.#pendingA ?? 0, this.#player.currentTime);
      } else if (event.key === '\\') {
        this.#player.clearLoop();
        this.#pendingA = null;
        this.#loopA.classList.remove('is-set');
      } else {
        return;
      }
      event.preventDefault();
    });
  }

  /** Put the speed somewhere and say so, in one place. */
  #setRate(rate: number): void {
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
    this.#player.playbackRate = clamped;
    this.#rate.value = String(clamped);
    // Always two decimals: a readout that shrinks from "0.85×" to "0.9×" as
    // you drag makes the number jump around under your eyes.
    this.#rateReadout.textContent = `${clamped.toFixed(2)}×`;
    // Full speed is the normal state and should not look like a setting.
    this.#rateReadout.classList.toggle('is-slowed', clamped !== 1);
  }

  update(state: State): void {
    const playing = state.playing;
    this.#playButton.replaceChildren(
      svgIcon(playing ? ICONS.pause : ICONS.play, playing ? 'Pause' : 'Play'),
    );
    this.#playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.#clock.textContent = `${formatClock(state.currentTime)} / ${formatClock(
      state.audio?.durationSec ?? 0,
    )}`;
    this.element.classList.toggle('is-disabled', !state.audio);

    this.#followButton.classList.toggle('is-on', state.followScore);
    this.#followButton.classList.toggle('is-paused', !state.followScore);
    this.#followButton.textContent = state.followScore ? 'Following' : 'Follow';
    this.#followButton.disabled = state.score === null;

    // Labelled by what you are looking at, like the notation switch: the
    // tooltip carries the verb, so the button never has to be read as a riddle.
    const folded = state.waveformHidden.includes(state.mode);
    this.#waveButton.classList.toggle('is-off', folded);
    this.#waveButton.setAttribute(
      'data-tip',
      folded
        ? 'Waveform folded away in this view\nThe parts of the song stay — click one to jump\nShow it again'
        : 'Fold the waveform away in this view\nThe parts of the song stay, so you can still jump\nRemembered per view',
    );
    this.#waveButton.disabled = !state.audio;

    const looping = state.loop !== null;
    this.#loopB.classList.toggle('is-set', looping);
    this.#loopClear.disabled = !looping && this.#pendingA === null;
    this.element.classList.toggle('is-looping', looping);
  }
}

/**
 * Half speed is about as slow as `preservesPitch` stays musical; below that a
 * vocal turns to artefacts and stops being something you can copy.
 */
const MIN_RATE = 0.5;
const MAX_RATE = 1;

const VOLUME_KEY = 'beyond.volume';

function readSavedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}

function saveVolume(level: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(level));
  } catch {
    // Private browsing or quota — the volume still works, it just won't persist.
  }
}

function iconButton(path: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    class: 'transport__button',
    type: 'button',
    'aria-label': label,
    'data-tip': label,
    onclick: onClick,
  });
  button.appendChild(svgIcon(path, label));
  return button;
}
