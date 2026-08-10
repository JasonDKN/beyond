import type { State, Store, ViewMode } from '@/core/store';
import { el } from './dom';

/**
 * Annotation ⇄ Learning.
 *
 * The two halves of the job want opposite screens. Timing a song is an editing
 * task — you want many lines visible and a clear sense of which is next.
 * Practising it is a reading task — you want one line large and in time, with
 * its phonetics under it.
 *
 * Making the split explicit also fixes a subtler problem: when both jobs share
 * one layout, behaviour that is right for one reads as a glitch in the other.
 */

const STORAGE_KEY = 'beyond.mode.';

/** A mode you chose by hand for a particular song, which outranks the default. */
const MODES: readonly ViewMode[] = ['annotation', 'compartmentalize', 'learning', 'practice'];

export function savedModeFor(audioKey: string): ViewMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + audioKey);
    return MODES.includes(raw as ViewMode) ? (raw as ViewMode) : null;
  } catch {
    return null;
  }
}

export function saveModeFor(audioKey: string, mode: ViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY + audioKey, mode);
  } catch {
    // Persisting the preference is a nicety, not a requirement.
  }
}

/**
 * What mode a song should open in, absent an explicit choice.
 *
 * Work still to do → Annotation. Everything timed and a score built →
 * Learning. The point is that the app opens on the job actually in front of
 * you, rather than always on step one.
 */
export function defaultModeFor(options: {
  hasScore: boolean;
  totalLines: number;
  timedLines: number;
}): ViewMode {
  if (options.totalLines === 0) return 'annotation';
  if (options.timedLines < options.totalLines) return 'annotation';
  return options.hasScore ? 'learning' : 'annotation';
}

export class ModeSwitchView {
  readonly element: HTMLElement;

  #store: Store;
  #buttons = new Map<ViewMode, HTMLButtonElement>();
  #onChoose: (mode: ViewMode) => void;

  constructor(store: Store, onChoose: (mode: ViewMode) => void) {
    this.#store = store;
    this.#onChoose = onChoose;

    const button = (mode: ViewMode, label: string, hint: string): HTMLButtonElement => {
      const node = el(
        'button',
        {
          class: 'modeswitch__button',
          type: 'button',
          title: hint,
          'aria-pressed': 'false',
          onclick: () => this.#choose(mode),
        },
        label,
      ) as HTMLButtonElement;
      this.#buttons.set(mode, node);
      return node;
    };

    this.element = el(
      'div',
      { class: 'modeswitch', role: 'group', 'aria-label': 'View mode' },
      button('annotation', 'Annotation', 'Paste lyrics and tap the timing'),
      button(
        'compartmentalize',
        'Compartmentalize',
        'Group the lines into sections, mark where they repeat, and say who sings what',
      ),
      button('learning', 'Learning', 'Follow the score and read along'),
      button('practice', 'Practice', 'Record yourself and score your timing'),
    );
  }

  update(state: State): void {
    for (const [mode, node] of this.#buttons) {
      const active = state.mode === mode;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', String(active));
    }
    // Neither Learning nor Practice has anything to show until a score exists
    // — Practice grades against the grid the score is built from.
    //
    // Compartmentalize is deliberately not gated on the score: sorting the
    // lyrics into sections is work you do *before* building, and a button you
    // cannot press until after the step it precedes is no button at all.
    this.#buttons.get('learning')?.toggleAttribute('disabled', state.score === null);
    this.#buttons.get('practice')?.toggleAttribute('disabled', state.score === null);
    this.element.classList.toggle('is-hidden', state.audio === null);
  }

  #choose(mode: ViewMode): void {
    if (this.#store.state.mode === mode) return;
    this.#onChoose(mode);
  }
}
