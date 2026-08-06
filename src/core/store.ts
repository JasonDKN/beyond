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
