import type { Player } from '@/audio/player';
import type { FullscreenLayout, State, Store } from '@/core/store';
import type { PhoneticLine } from '@/core/types';
import { el, formatClock, ICONS, seekIcon, svgIcon } from './dom';
import { visibleLayers, type LayerKind } from './layers';

/**
 * The words, and nothing else.
 *
 * Not a fifth mode. Beyond's four modes are steps in a piece of work — write
 * the words, time them, learn them, record yourself — and this is none of
 * those; it is a way of *looking* at the learning step. So it lifts over
 * whatever view you are in, leaves that view untouched underneath, and drops
 * away again without changing where you were.
 *
 * Two layouts, because two different moments want different things:
 *
 *   Teleprompter gives the sung line most of the screen and shows what is
 *   coming below it, small. For singing along at speed, when you need the
 *   current words enormous and just enough warning of the next.
 *
 *   Karaoke weights several lines evenly. For working out a verse — seeing
 *   where a phrase sits among its neighbours matters more than reading any one
 *   line at arm's length.
 *
 * Both are driven by the same word timings as everything else, so the karaoke
 * wipe here is the same wipe as the score: it fills as the singer sings, at
 * whatever speed the track is playing.
 */

const LAYER_CLASS: Record<LayerKind, string> = {
  written: 'fs__written',
  spoken: 'fs__spoken',
  ipa: 'fs__ipa',
  respelling: 'fs__respell',
};

/** Which lines each layout puts on screen, relative to the one being sung. */
const WINDOW: Record<FullscreenLayout, readonly number[]> = {
  teleprompter: [0, 1, 2],
  karaoke: [-1, 0, 1, 2, 3],
};

/** How long the controls stay after you stop touching anything, while playing. */
const IDLE_MS = 2600;

/** How far a finger has to travel before it counts as a swipe and not a tap. */
const SWIPE_PX = 60;
/** And how much more horizontal than vertical, so a scroll is never a step. */
const SWIPE_RATIO = 1.6;
/** Two taps closer together than this are a double-tap. */
const DOUBLE_TAP_MS = 320;

/**
 * How far the auto-fit will shrink the words before giving up.
 *
 * Past this they are too small to read at arm's length while your mouth is
 * busy, which is the whole job — better to let the stage scroll than to keep
 * shrinking into something nobody can use.
 */
const MIN_SCALE = 0.55;

/**
 * The legend, in the language of whatever you are holding.
 *
 * Keys on a desktop, gestures on a phone — and never both, because a legend
 * listing keys to somebody holding a phone is worse than no legend at all. Both
 * are built and CSS picks, rather than JavaScript sniffing the device: a laptop
 * with a touchscreen answers `pointer: coarse` truthfully for the pointer being
 * used, which is the actual question.
 */
const KEY_LEGEND: readonly (readonly [string, string])[] = [
  ['Space', 'Play / pause'],
  ['← →', 'Back / forward 3s'],
  [', .', 'Previous / next line'],
  ['[  ]  \\', 'Loop start, end, clear'],
  ['Esc', 'Leave fullscreen'],
];

const TOUCH_LEGEND: readonly (readonly [string, string])[] = [
  ['Swipe ←→', 'Previous / next line'],
  ['Double-tap', 'Play / pause'],
  ['⋯', 'Speed, loop, layers'],
];

export interface FullscreenCallbacks {
  onExit(): void;
  onStepLine(delta: number): void;
  onSetLayout(layout: FullscreenLayout): void;
}

export class FullscreenView {
  readonly element: HTMLElement;

  #store: Store;
  #player: Player;
  #callbacks: FullscreenCallbacks;

  #stage: HTMLElement;
  #bar: HTMLElement;
  #playButton: HTMLButtonElement;
  #clock: HTMLElement;
  #rate: HTMLInputElement;
  #rateReadout: HTMLElement;
  #loopA: HTMLButtonElement;
  #loopB: HTMLButtonElement;
  #layoutButton: HTMLButtonElement;
  #moreButton: HTMLButtonElement;
  #layerButtons = new Map<keyof State['layers'], HTMLButtonElement>();

  #pendingA: number | null = null;
  /** The loop start last adopted from the store, so we adopt it only once. */
  #lastLoopStart: number | null = null;
  #renderedKey = '';
  #renderedPlaying: boolean | null = null;
  /** Line index → the word nodes drawn for it, for the wipe. */
  #wordNodes = new Map<number, HTMLElement[]>();
  #wipedLine = -1;
  #idleTimer = 0;

  constructor(store: Store, player: Player, callbacks: FullscreenCallbacks) {
    this.#store = store;
    this.#player = player;
    this.#callbacks = callbacks;

    this.#stage = el('div', { class: 'fs__stage' });

    this.#playButton = el('button', {
      class: 'fs__play',
      type: 'button',
      'aria-label': 'Play',
      onclick: () => this.#player.toggle(),
    }) as HTMLButtonElement;
    this.#playButton.appendChild(svgIcon(ICONS.play, 'Play'));

    this.#clock = el('div', { class: 'fs__clock' }, '0:00');

    this.#rate = el('input', {
      class: 'fs__rate',
      type: 'range',
      min: '0.5',
      max: '1',
      step: '0.01',
      value: '1',
      'aria-label': 'Playback speed',
      oninput: () => this.#setRate(Number(this.#rate.value)),
    }) as HTMLInputElement;
    this.#rateReadout = el('span', { class: 'fs__rate-value' }, '1.00×');

    this.#loopA = el(
      'button',
      {
        class: 'fs__chip',
        type: 'button',
        'aria-label': 'Set the loop start here',
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
        class: 'fs__chip',
        type: 'button',
        'aria-label': 'Set the loop end here and start looping',
        onclick: () => this.#player.setLoop(this.#pendingA ?? 0, this.#player.currentTime),
      },
      'B',
    ) as HTMLButtonElement;

    const loopClear = el(
      'button',
      {
        class: 'fs__chip',
        type: 'button',
        'aria-label': 'Clear the loop',
        onclick: () => {
          this.#player.clearLoop();
          this.#pendingA = null;
          this.#loopA.classList.remove('is-set');
        },
      },
      '✕',
    );

    this.#layoutButton = el(
      'button',
      {
        class: 'fs__chip fs__chip--wide',
        type: 'button',
        onclick: () => {
          const next = this.#store.state.fullscreenLayout === 'teleprompter'
            ? 'karaoke'
            : 'teleprompter';
          this.#callbacks.onSetLayout(next);
        },
      },
      'Teleprompter',
    ) as HTMLButtonElement;

    /*
     * The settings, folded away on a small screen.
     *
     * On a phone the full bar came to a quarter of the screen — a quarter spent
     * on speed and layer switches you set once and then leave alone, taken from
     * the words you are trying to read. So on narrow and short screens they go
     * behind this, and the row that survives is the one you actually touch
     * mid-song: back, previous line, play, next line, forward.
     *
     * There is no such button on a desktop, where the bar has always fitted on
     * one line and folding it would be hiding things for no reason.
     */
    this.#moreButton = el(
      'button',
      {
        class: 'fs__chip fs__more',
        type: 'button',
        'aria-expanded': 'false',
        'aria-label': 'More controls',
        onclick: () => {
          const open = this.element.classList.toggle('is-open');
          this.#moreButton.setAttribute('aria-expanded', String(open));
          this.#wake();
        },
      },
      '⋯',
    ) as HTMLButtonElement;

    this.#bar = el(
      'div',
      { class: 'fs__bar' },
      el(
        'div',
        { class: 'fs__group' },
        seekChip(5, true, () => this.#player.nudge(-5)),
        stepChip(-1, 'Previous line', () => this.#callbacks.onStepLine(-1)),
        this.#playButton,
        stepChip(1, 'Next line', () => this.#callbacks.onStepLine(1)),
        seekChip(5, false, () => this.#player.nudge(5)),
      ),
      this.#clock,
      el(
        'div',
        { class: 'fs__group fs__group--speed' },
        el('span', { class: 'fs__label' }, 'Speed'),
        this.#rate,
        this.#rateReadout,
      ),
      el(
        'div',
        { class: 'fs__group fs__group--loop' },
        el('span', { class: 'fs__label' }, 'Loop'),
        this.#loopA,
        this.#loopB,
        loopClear,
      ),
      el('div', { class: 'fs__group fs__group--layers' }, ...this.#buildLayerToggles()),
      el(
        'div',
        { class: 'fs__group fs__group--right' },
        this.#moreButton,
        this.#layoutButton,
        el(
          'button',
          {
            class: 'fs__chip fs__chip--exit',
            type: 'button',
            'aria-label': 'Leave fullscreen',
            onclick: () => this.#callbacks.onExit(),
          },
          'Exit',
        ),
      ),
    );

    this.element = el(
      'div',
      { class: 'fs', hidden: true },
      legend('fs__legend--keys', KEY_LEGEND),
      legend('fs__legend--touch', TOUCH_LEGEND),
      this.#stage,
      this.#bar,
    );

    this.#bindGestures();

    /*
     * The controls get out of the way while you are singing.
     *
     * Any touch or movement brings them back, and they never hide while
     * paused — a still screen with no controls looks broken rather than
     * clean.
     */
    for (const kind of ['pointermove', 'pointerdown', 'touchstart', 'keydown'] as const) {
      this.element.addEventListener(kind, () => this.#wake(), { passive: true });
    }
  }

  /**
   * The two things a phone can do that a bar cannot.
   *
   * Both exist because the controls hide themselves while the song plays, and a
   * screen with no controls on it needs *some* answer to "next line" that does
   * not begin with waking the bar up. They are on the stage rather than the
   * whole overlay so that dragging a slider in the bar is never read as a
   * swipe across the words.
   */
  #bindGestures(): void {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lastTapAt = 0;

    this.#stage.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        startX = event.clientX;
        startY = event.clientY;
        startT = event.timeStamp;
      },
      { passive: true },
    );

    /*
     * A cancelled gesture is not a tap.
     *
     * The browser cancels a pointer when it decides the gesture is really a
     * scroll, and a cancelled pointer never raises `pointerup`. Without this,
     * a half-finished drag left the start coordinates lying around for the
     * next event to measure against.
     */
    this.#stage.addEventListener(
      'pointercancel',
      () => {
        startX = Number.NaN;
        lastTapAt = 0;
      },
      { passive: true },
    );

    this.#stage.addEventListener(
      'pointerup',
      (event: PointerEvent) => {
        if (Number.isNaN(startX)) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;

        // Far enough for this screen: a fixed 60px is a long way on a phone
        // and nothing on a desktop, so it scales, within reason.
        const far = Math.min(SWIPE_PX, Math.max(28, this.#stage.clientWidth * 0.12));

        // A swipe: far enough, and clearly sideways rather than a scroll.
        if (Math.abs(dx) > far && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
          // Leftwards moves forward, the way a page of anything turns.
          this.#callbacks.onStepLine(dx < 0 ? 1 : -1);
          lastTapAt = 0;
          return;
        }

        // A tap: barely moved, and quick. Two of them toggle playback.
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || event.timeStamp - startT > 500) return;
        if (event.timeStamp - lastTapAt < DOUBLE_TAP_MS) {
          this.#player.toggle();
          lastTapAt = 0;
          return;
        }
        lastTapAt = event.timeStamp;
      },
      { passive: true },
    );
  }

  #buildLayerToggles(): HTMLElement[] {
    const layers: [keyof State['layers'], string][] = [
      ['written', 'Written'],
      ['pronounced', 'Spoken'],
      ['ipa', 'IPA'],
      ['respelling', 'Read-along'],
      ['translation', 'Meaning'],
    ];
    return layers.map(([key, label]) => {
      const button = el(
        'button',
        {
          class: 'fs__chip',
          type: 'button',
          onclick: () => {
            const current = this.#store.state.layers;
            this.#store.patch({ layers: { ...current, [key]: !current[key] } });
          },
        },
        label,
      ) as HTMLButtonElement;
      this.#layerButtons.set(key, button);
      return button;
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Ask the browser for the whole screen.
   *
   * Failure here is not worth reporting: a browser that refuses — or a device
   * that has no such concept — still shows the layout filling the page, which
   * is most of the benefit. The state is the app's; the fullscreen call is a
   * bonus on top of it.
   */
  async enter(): Promise<void> {
    this.#wake();
    try {
      if (!document.fullscreenElement) await this.element.requestFullscreen();
    } catch {
      /* Filling the page is enough. */
    }
  }

  async leave(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* Already gone. */
    }
  }

  update(state: State): void {
    const on = state.fullscreen;
    this.element.hidden = !on;
    if (!on) return;

    // Rebuild only when the window of lines or the layout actually moves —
    // this runs on every tick of the clock.
    const active = this.#store.activeLineIndex();
    const key = `${state.fullscreenLayout}:${active}:${Object.values(state.layers).join('')}:${
      state.score?.lines.length ?? 0
    }`;
    if (key !== this.#renderedKey) {
      this.#renderedKey = key;
      this.#draw(state, active);
      this.#fit();
    }

    this.#wipe(state, active);
    this.#syncControls(state);
  }

  #syncControls(state: State): void {
    if (state.playing !== this.#renderedPlaying) {
      this.#renderedPlaying = state.playing;
      this.#playButton.replaceChildren(
        svgIcon(state.playing ? ICONS.pause : ICONS.play, state.playing ? 'Pause' : 'Play'),
      );
      this.#playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
      this.#wake();
    }

    this.#clock.textContent = `${formatClock(state.currentTime)} / ${formatClock(
      state.audio?.durationSec ?? 0,
    )}`;

    // Both ends light when a loop exists, wherever it was made — see the same
    // reasoning in transport.ts. A alone means armed and waiting for B.
    const start = state.loop?.start ?? null;
    if (start !== null && start !== this.#lastLoopStart) this.#pendingA = start;
    this.#lastLoopStart = start;
    this.#loopA.classList.toggle('is-set', state.loop !== null || this.#pendingA !== null);
    this.#loopB.classList.toggle('is-set', state.loop !== null);

    const teleprompter = state.fullscreenLayout === 'teleprompter';
    this.#layoutButton.textContent = teleprompter ? 'Teleprompter' : 'Karaoke';
    this.#layoutButton.setAttribute(
      'aria-label',
      `Layout: ${teleprompter ? 'teleprompter' : 'karaoke'}. Switch to the other`,
    );
    this.element.classList.toggle('is-teleprompter', teleprompter);
    this.element.classList.toggle('is-karaoke', !teleprompter);

    for (const [key, button] of this.#layerButtons) {
      button.classList.toggle('is-on', state.layers[key]);
    }
  }

  #draw(state: State, active: number): void {
    this.#stage.replaceChildren();
    this.#wordNodes.clear();
    this.#wipedLine = -1;

    const lines = state.score?.lines ?? [];
    if (lines.length === 0) {
      this.#stage.append(
        el('p', { class: 'fs__empty' }, 'Nothing timed yet — build the score first.'),
      );
      return;
    }

    // Before the first line has arrived, show the opening lines rather than an
    // empty screen: you are usually looking at this during the intro.
    const centre = active < 0 ? 0 : active;
    for (const offset of WINDOW[state.fullscreenLayout]) {
      const index = centre + offset;
      const line = lines[index];
      if (!line) continue;
      this.#stage.append(this.#drawLine(state, line, index, offset));
    }
  }

  #drawLine(state: State, line: PhoneticLine, index: number, offset: number): HTMLElement {
    const nodes: HTMLElement[] = [];
    const words = line.words.map((word) => {
      const stack = visibleLayers(word, state.layers).map((part) =>
        el(
          'span',
          {
            class: LAYER_CLASS[part.kind],
            ...(part.kind === 'ipa' ? { lang: 'und-fonipa' } : {}),
          },
          part.text,
        ),
      );
      const node = el('span', { class: 'fs__word' }, ...stack);
      nodes.push(node);
      return node;
    });
    this.#wordNodes.set(index, nodes);

    const where = offset === 0 ? 'now' : offset < 0 ? 'past' : 'next';
    const row = el('div', { class: 'fs__words' }, ...words);

    /*
     * The meaning, under the line being sung and only that one.
     *
     * On every line it would be a wall of English competing with the Korean
     * for the same eye, which is the opposite of the point — you are here to
     * read the Korean. Under the current line it answers the question at the
     * moment you have it, and disappears again as the song moves on.
     */
    const meaning =
      where === 'now' && state.layers.translation && line.translation
        ? el('p', { class: 'fs__meaning', lang: 'en' }, line.translation)
        : null;

    return el('div', { class: `fs__line fs__line--${where}` }, row, meaning);
  }

  /** The same wipe the score uses, driven by the same word timings. */
  #wipe(state: State, active: number): void {
    if (this.#wipedLine !== active && this.#wipedLine >= 0) {
      for (const node of this.#wordNodes.get(this.#wipedLine) ?? []) {
        node.classList.remove('is-sung');
        node.style.removeProperty('--sung');
      }
    }
    this.#wipedLine = active;
    if (active < 0) return;

    const words = state.score?.lines[active]?.words ?? [];
    const nodes = this.#wordNodes.get(active) ?? [];
    nodes.forEach((node, index) => {
      const word = words[index];
      if (!word) return;
      if (state.currentTime >= word.startSec && state.currentTime <= word.endSec) {
        const span = Math.max(0.001, word.endSec - word.startSec);
        node.style.setProperty(
          '--sung',
          String(Math.min(Math.max((state.currentTime - word.startSec) / span, 0), 1)),
        );
        node.classList.remove('is-sung');
        node.classList.add('is-singing');
      } else {
        node.style.removeProperty('--sung');
        node.classList.remove('is-singing');
        node.classList.toggle('is-sung', word.endSec <= state.currentTime);
      }
    });
  }

  #setRate(rate: number): void {
    const clamped = Math.min(1, Math.max(0.5, Math.round(rate * 100) / 100));
    this.#player.playbackRate = clamped;
    this.#rate.value = String(clamped);
    this.#rateReadout.textContent = `${clamped.toFixed(2)}×`;
  }

  /**
   * Shrink the words until they fit the screen they are actually on.
   *
   * The sizes are written against viewport width, which is a guess about
   * height — and the guess fails wherever the two come apart: a phone in
   * landscape, a long line that wraps to three rows, a word carrying four
   * layers where its neighbours carry two. `safe center` means the overflow
   * can now be scrolled to rather than lost, but scrolling is the wrong answer
   * on a screen you are reading while singing.
   *
   * So this measures what actually happened and steps the type down until it
   * fits. Cheap, because it only runs when the window of lines changes, and
   * honest, because it reacts to the real layout instead of predicting it.
   *
   * There is a floor: past a point the words are too small to read while your
   * mouth is busy, and scrolling is the better failure.
   */
  #fit(): void {
    const stage = this.#stage;
    let scale = 1;
    stage.style.setProperty('--fs-scale', '1');

    // A handful of steps is plenty to cross the range, and bounded so a
    // pathological line can never spin here.
    for (let step = 0; step < 8; step += 1) {
      if (stage.scrollHeight <= stage.clientHeight + 1) break;
      scale -= 0.07;
      if (scale < MIN_SCALE) {
        scale = MIN_SCALE;
        stage.style.setProperty('--fs-scale', String(scale));
        break;
      }
      stage.style.setProperty('--fs-scale', scale.toFixed(2));
    }
  }

  /** Re-fit after the screen changes shape — rotation, mostly. */
  resize(): void {
    if (!this.element.hidden) this.#fit();
  }

  /** Bring the controls back, and start the clock on hiding them again. */
  #wake(): void {
    this.element.classList.remove('is-idle');
    window.clearTimeout(this.#idleTimer);
    this.#idleTimer = window.setTimeout(() => {
      // Never while paused: a still screen with no controls reads as broken.
      if (this.#store.state.playing) this.element.classList.add('is-idle');
    }, IDLE_MS);
  }
}

/**
 * A small card of what you can do, off in the corner.
 *
 * It fades out with the control bar once the song is running and you have gone
 * quiet, so it teaches on the way in and then gets out of the way — which is
 * the only honest shape for a legend on a screen whose whole purpose is having
 * nothing on it but the words.
 */
function legend(variant: string, items: readonly (readonly [string, string])[]): HTMLElement {
  return el(
    'dl',
    { class: `fs__legend ${variant}`, 'aria-label': 'Shortcuts' },
    ...items.flatMap(([keys, what]) => [
      el('dt', { class: 'fs__legend-keys' }, keys),
      el('dd', { class: 'fs__legend-what' }, what),
    ]),
  );
}

const LAYOUT_KEY = 'beyond.fullscreen-layout';

/**
 * Which layout to open in, remembered.
 *
 * Not part of the save file: this is about the person, not the song. Somebody
 * who reads better in karaoke reads better in karaoke on every track, and
 * carrying that choice inside a project would hand it to whoever they send the
 * file to.
 */
export function loadFullscreenLayout(): FullscreenLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'karaoke' ? 'karaoke' : 'teleprompter';
  } catch {
    return 'teleprompter';
  }
}

export function saveFullscreenLayout(layout: FullscreenLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* Private browsing — it still works, it just won't be remembered. */
  }
}

function seekChip(seconds: number, back: boolean, onClick: () => void): HTMLButtonElement {
  const label = `${back ? 'Back' : 'Forward'} ${seconds} seconds`;
  const button = el('button', {
    class: 'fs__round',
    type: 'button',
    'aria-label': label,
    onclick: onClick,
  });
  button.appendChild(seekIcon(seconds, back));
  return button;
}

function stepChip(delta: number, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    class: 'fs__round',
    type: 'button',
    'aria-label': label,
    onclick: onClick,
  });
  button.appendChild(
    svgIcon(delta < 0 ? 'M7 5h2.2v14H7zm12 0v14l-9-7z' : 'M14.8 5H17v14h-2.2zM5 5l9 7-9 7z', label),
  );
  return button;
}
