import { Emitter } from './events';
import type {
  AudioSource,
  LanguageTag,
  Notation,
  PeakEnvelope,
  PhoneticScore,
  Progress,
} from './types';
import { DEFAULT_SINGING_OPTIONS, type SingingOptions } from '@/phonetics/singing';

export type Status = 'idle' | 'working' | 'ready' | 'error';

/**
 * The two things you actually do with this app, made explicit.
 *
 * They want opposite layouts. Timing a song is a text task: you need to see
 * many lines at once and know which one is next. Practising it is a reading
 * task: you need one line large, in time, with its phonetics under it. Trying
 * to serve both from one screen is what made the follow-along behaviour feel
 * arbitrary — it was following in a layout built for editing.
 */
export type ViewMode = 'annotation' | 'learning';

export interface WordRef {
  readonly lineIndex: number;
  readonly wordIndex: number;
}

export interface State {
  readonly status: Status;
  readonly audio: AudioSource | null;
  readonly envelope: PeakEnvelope | null;
  readonly onsets: readonly number[];
  readonly score: PhoneticScore | null;
  readonly progress: Progress | null;
  readonly error: string | null;
  /**
   * A "here's what to do next" message, as distinct from a failure.
   *
   * Loading a song before pasting its lyrics is the normal first step, not an
   * error, and colouring it red taught the wrong thing about a working app.
   */
  readonly notice: string | null;

  readonly providerId: string;
  readonly inputLanguage: LanguageTag | 'auto';
  readonly outputLanguage: LanguageTag | null;
  readonly notation: Notation;
  readonly syllableBreaks: boolean;
  readonly stressMarks: boolean;
  readonly singing: SingingOptions;

  readonly currentTime: number;
  readonly playing: boolean;
  readonly selected: WordRef | null;
  readonly loop: { start: number; end: number } | null;

  readonly mode: ViewMode;
  /**
   * Whether the score scrolls itself to keep up with the music.
   *
   * Lives in the store rather than inside the view so the transport can show
   * its state. Turned off only by scrolling by hand — never by clicking a
   * word, which is a thing you do *while* following.
   */
  readonly followScore: boolean;

  /**
   * Which readings of each word to show, stacked.
   *
   * A learner starts on the respelling and graduates to IPA; being able to
   * hide a layer is what lets one tool serve both ends of that journey rather
   * than being outgrown.
   */
  readonly layers: DisplayLayers;
}

export interface DisplayLayers {
  /** The words as written — the lyric sheet. */
  readonly written: boolean;
  /** The words as actually pronounced, in their own script. */
  readonly pronounced: boolean;
  readonly ipa: boolean;
  /** Plain-alphabet reading. */
  readonly respelling: boolean;
  /** Per-word morpheme breakdown under the line. */
  readonly morphemes: boolean;
}

type StoreEvents = {
  change: State;
};

/**
 * One state object, one change event.
 *
 * Everything the UI draws is a pure function of this, which is what makes the
 * canvas and the DOM stay in step without a reconciler between them.
 */
export class Store {
  readonly events = new Emitter<StoreEvents>();

  #state: State = {
    status: 'idle',
    audio: null,
    envelope: null,
    onsets: [],
    score: null,
    progress: null,
    error: null,
    notice: null,
    providerId: 'lyrics',
    inputLanguage: 'ko',
    outputLanguage: null,
    notation: 'ipa',
    syllableBreaks: false,
    stressMarks: true,
    singing: DEFAULT_SINGING_OPTIONS,
    currentTime: 0,
    playing: false,
    selected: null,
    loop: null,
    mode: 'annotation',
    followScore: true,
    layers: {
      written: true,
      pronounced: true,
      ipa: true,
      respelling: true,
      morphemes: false,
    },
  };

  get state(): State {
    return this.#state;
  }

  patch(changes: Partial<State>): void {
    this.#state = { ...this.#state, ...changes };
    this.events.emit('change', this.#state);
  }

  /** The word currently being sung, or null between words. */
  activeWord(): WordRef | null {
    const { score, currentTime } = this.#state;
    if (!score) return null;
    for (const [lineIndex, line] of score.lines.entries()) {
      if (currentTime < line.startSec || currentTime > line.endSec + 0.25) continue;
      for (const [wordIndex, word] of line.words.entries()) {
        if (currentTime >= word.startSec && currentTime <= word.endSec) {
          return { lineIndex, wordIndex };
        }
      }
    }
    return null;
  }

  activeLineIndex(): number {
    const { score, currentTime } = this.#state;
    if (!score) return -1;
    let best = -1;
    score.lines.forEach((line, index) => {
      if (currentTime >= line.startSec - 0.15) best = index;
    });
    return best;
  }

  wordAt(ref: WordRef | null) {
    if (!ref) return null;
    return this.#state.score?.lines[ref.lineIndex]?.words[ref.wordIndex] ?? null;
  }
}

export const store = new Store();
