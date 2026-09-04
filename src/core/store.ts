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
 * The four things you actually do with this app, in the order you do them.
 *
 * Each wants a different screen. Setup is a writing task — one big box and
 * nothing else to look at. Beatmap is a timing task: many lines visible, the
 * next one obvious, the waveform showing the vocal coming. Learning is a
 * reading task: one line large and in time with its phonetics under it. And
 * Practice is a recording task.
 *
 * Trying to serve two of these from one screen is what made the follow-along
 * behaviour feel arbitrary — it was following in a layout built for editing.
 */
export type ViewMode = 'setup' | 'beatmap' | 'learning' | 'practice';

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

  /** Fingerprint of the loaded audio — the key everything saved hangs off. */
  readonly trackId: string | null;
  /**
   * Whether the current track's work is written to disk.
   *
   * Saving has always been automatic, but silent — and silent saving is
   * indistinguishable from no saving when you are about to close a song you
   * spent an hour timing. This exists so the interface can say so.
   */
  readonly saveState: 'idle' | 'saving' | 'saved' | 'failed';
  readonly savedAt: number | null;
  /** The track drawer, over the workspace. */
  readonly libraryOpen: boolean;
  readonly mode: ViewMode;
  /**
   * Whether any lyrics have been pasted.
   *
   * Mirrored into the store because the lyric sheet lives outside it, and the
   * mode switch has to know whether Beatmap has anything to tap.
   */
  readonly hasLyrics: boolean;
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

  /**
   * Views in which the waveform is folded away, leaving the parts of the song.
   *
   * Per view, because the right answer differs: Beatmap is aiming at something
   * you can see coming, Learning is reading words. Kept in the store so the
   * transport can draw the state of its own switch.
   */
  readonly waveformHidden: readonly ViewMode[];

  /**
   * Reading the words with nothing else on screen.
   *
   * Not a fifth mode: it is a way of *looking* at Learning rather than a step
   * in the work, so it toggles on top of whatever view you are in and leaves
   * that view exactly as it was underneath.
   */
  readonly fullscreen: boolean;

  /**
   * Which of the two fullscreen layouts is showing.
   *
   * They answer different moments. `teleprompter` gives the sung line the
   * whole screen and shows what is coming beneath it — for singing along at
   * speed. `karaoke` weights several lines evenly — for seeing a verse whole
   * while you work out where you are in it.
   */
  readonly fullscreenLayout: FullscreenLayout;
}

export type FullscreenLayout = 'teleprompter' | 'karaoke';

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
  /**
   * What the line means, in the words you typed for it.
   *
   * A layer like the others, because that is what it is: another reading of
   * the same line, and the one that answers the question the phonetics cannot.
   * Knowing how to say a line you do not understand gets you through a
   * performance and nowhere near the language.
   */
  readonly translation: boolean;
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
    trackId: null,
    saveState: 'idle',
    savedAt: null,
    libraryOpen: false,
    mode: 'setup',
    hasLyrics: false,
    followScore: true,
    layers: {
      written: true,
      pronounced: true,
      ipa: true,
      respelling: true,
      morphemes: false,
      translation: true,
    },
    waveformHidden: [],
    fullscreen: false,
    fullscreenLayout: 'teleprompter',
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
