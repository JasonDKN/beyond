import type { Player } from '@/audio/player';
import type { State } from '@/core/store';
import { el, formatClock, ICONS, seekIcon, svgIcon } from './dom';

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
  #fullscreenButton: HTMLButtonElement;
  /**
   * What the buttons currently show.
   *
   * Kept so nothing clickable is rebuilt on a tick that did not change it.
   * Replacing the contents of a control while someone is pressing it loses the
   * press — the element the mouse went down on no longer exists to raise a
   * click, and the button silently does nothing.
   */
  #renderedPlaying: boolean | null = null;
  #renderedFollow: boolean | null = null;

  constructor(
    player: Player,
    onZoom: (zoom: number) => void,
    onResumeFollow: () => void,
    onToggleWaveform: () => void,
    onStepLine: (delta: number) => void,
    onToggleFullscreen: () => void,
  ) {
    this.#player = player;
    this.#onZoom = onZoom;
    this.#onResumeFollow = onResumeFollow;

    /*
     * The words, and nothing else.
     *
     * Deliberately a switch on this bar rather than a fifth entry on the mode
     * switch. The four modes are steps in a piece of work; this is a way of
     * looking at one of them, and putting it beside them would have said it was
     * somewhere else to go rather than the same place, larger.
     */
    this.#fullscreenButton = el(
      'button',
      {
        class: 'transport__fullscreen',
        type: 'button',
        'aria-label': 'Fullscreen',
        onclick: () => onToggleFullscreen(),
      },
      '⛶',
    ) as HTMLButtonElement;

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
        /*
         * Two grains of moving about, innermost first.
         *
         * Line steps sit closest to Play because they are the ones you reach
         * for while practising — a line is the unit you are actually working
         * on. The five-second jumps sit outside them, for catching the run-up
         * into a phrase rather than the phrase itself.
         */
        seekButton(5, true, () => this.#player.nudge(-5)),
        lineButton(-1, 'Previous line', () => onStepLine(-1)),
        this.#playButton,
        lineButton(1, 'Next line', () => onStepLine(1)),
        seekButton(5, false, () => this.#player.nudge(5)),
      ),
      this.#clock,
      /*
       * A and B, under the word they belong to.
       *
       * The letters are the convention in practice software and worth keeping
       * — they are short, and either end can be reset on its own. What they
       * lacked was any clue what they were for, which one small heading fixes
       * without spending the width two spelled-out buttons would.
       */
      el(
        'div',
        { class: 'transport__group transport__loop' },
        el('span', { class: 'transport__loop-label' }, 'Loop'),
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
        this.#fullscreenButton,
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
    /*
     * Only when it actually changes — and that is a bug fix, not a saving.
     *
     * This ran unconditionally, and `update` runs on every store change, which
     * during playback is every tick of the clock. So while a song played, the
     * icon inside the play button was destroyed and rebuilt dozens of times a
     * second. Press the mouse down on it and the element under the cursor was
     * gone before you let go, so the browser had no single target to raise a
     * click on and the press did nothing.
     *
     * The asymmetry was the tell: paused, nothing is ticking and Play always
     * worked; playing, Pause only worked if you happened to land in a gap
     * between rebuilds. It felt like hunting for a sweet spot because it was.
     */
    if (playing !== this.#renderedPlaying) {
      this.#renderedPlaying = playing;
      this.#playButton.replaceChildren(
        svgIcon(playing ? ICONS.pause : ICONS.play, playing ? 'Pause' : 'Play'),
      );
      this.#playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      // A short flash on the change, so the button visibly answers the press
      // rather than only the icon quietly differing afterwards.
      this.#playButton.classList.remove('is-struck');
      void this.#playButton.offsetWidth; // restart the animation
      this.#playButton.classList.add('is-struck');
    }
    this.#clock.textContent = `${formatClock(state.currentTime)} / ${formatClock(
      state.audio?.durationSec ?? 0,
    )}`;
    this.element.classList.toggle('is-disabled', !state.audio);

    this.#followButton.classList.toggle('is-on', state.followScore);
    this.#followButton.classList.toggle('is-paused', !state.followScore);
    // Same reasoning as the play button: setting textContent replaces the text
    // node, and doing that on every tick is enough to eat a click on it.
    if (state.followScore !== this.#renderedFollow) {
      this.#renderedFollow = state.followScore;
      this.#followButton.textContent = state.followScore ? 'Following' : 'Follow';
    }
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

    // Labelled by what pressing it does, not by what is on screen — the icon
    // already says which state you are in.
    this.#fullscreenButton.classList.toggle('is-on', state.fullscreen);
    this.#fullscreenButton.setAttribute(
      'data-tip',
      state.fullscreen
        ? 'Leave fullscreen\nOr press `F`, `F2` or `Esc`'
        : 'The words, filling the screen\nOr press `F` or `F2`',
    );
    this.#fullscreenButton.setAttribute(
      'aria-label',
      state.fullscreen ? 'Leave fullscreen' : 'Fullscreen',
    );
    this.#fullscreenButton.disabled = state.score === null;

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

/** A circular-arrow seek button, with the seconds written inside it. */
function seekButton(seconds: number, back: boolean, onClick: () => void): HTMLButtonElement {
  const label = `${back ? 'Back' : 'Forward'} ${seconds} seconds`;
  const button = el('button', {
    class: 'transport__button transport__button--seek',
    type: 'button',
    'aria-label': label,
    'data-tip': label,
    onclick: onClick,
  });
  button.appendChild(seekIcon(seconds, back));
  return button;
}

/** Step to the line before or after the one playing. */
function lineButton(delta: number, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    class: 'transport__button transport__button--line',
    type: 'button',
    'aria-label': label,
    'data-tip': `${label}\nOr press \`${delta < 0 ? ',' : '.'}\``,
    onclick: onClick,
  });
  // A bar against a triangle: the same shape a track-skip has everywhere, which
  // is exactly the gesture — jump to the edge of the next thing.
  button.appendChild(
    svgIcon(
      delta < 0 ? 'M7 5h2.2v14H7zm12 0v14l-9-7z' : 'M14.8 5H17v14h-2.2zM5 5l9 7-9 7z',
      label,
    ),
  );
  return button;
}

