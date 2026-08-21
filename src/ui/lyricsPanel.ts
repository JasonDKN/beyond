import type { Player } from '@/audio/player';
import type { State, Store } from '@/core/store';
import type { LanguageTag } from '@/core/types';
import { saveTrack } from '@/storage/library';
import {
  getSheet,
  parseSheet,
  setSheet,
  sheetToText,
  splitWords,
  wordCount,
  type LyricLine,
  type LyricSection,
  type LyricSheet,
} from '@/transcription/providers/lyrics';

/** How far before a line to rewind when you ask to re-time it. */
const LEAD_IN_SEC = 2.5;

/**
 * Which way the sheet spells out how a word sounds.
 *
 * Two answers to one question. IPA is exact and has to be learned; the
 * respelling is approximate and can be read on sight. Which one helps depends
 * entirely on who is looking, so it is a choice rather than a decision, and it
 * is remembered — nobody wants to reset it every time they open a song.
 */
export type ReadingStyle = 'respell' | 'ipa';

const READING_KEY = 'beyond.reading';

function loadReadingStyle(): ReadingStyle {
  try {
    return localStorage.getItem(READING_KEY) === 'ipa' ? 'ipa' : 'respell';
  } catch {
    // Private browsing, or storage turned off. A default is a fine answer.
    return 'respell';
  }
}

function saveReadingStyle(style: ReadingStyle): void {
  try {
    localStorage.setItem(READING_KEY, style);
  } catch {
    // Losing the preference is a small thing; failing to switch is not.
  }
}
/**
 * The same, for words — shorter, because you are already inside the line and
 * a long run-up would put several words in front of the one you came for.
 */
const WORD_LEAD_IN_SEC = 1.2;
import {
  canRead,
  loadReadings,
  needsLatinEngine,
  readLine,
  readWord,
  type WordReading,
} from '@/phonetics/readings';
import { clear, el, formatClock } from './dom';

/**
 * Paste the words, tap the timing.
 *
 * Two states. First you paste the lyric text — yours, from the sleeve or
 * wherever you keep it; Beyond neither fetches nor ships anyone's lyrics.
 * Then you play the track and hit Tap (or the T key) as each line begins.
 *
 * Tapping is unfashionable and completely reliable. Three minutes of it gives
 * timings a forced aligner would not beat on fast rap, and every tap is
 * correctable without re-running anything.
 */

export interface LyricsPanelCallbacks {
  onBuild(): void;
  /** The lyrics are in; go and time them. */
  onLyricsReady(): void;
}

export class LyricsPanelView {
  readonly element: HTMLElement;

  #store: Store;
  #player: Player;
  #callbacks: LyricsPanelCallbacks;

  #textarea: HTMLTextAreaElement;
  #list: HTMLElement;
  #tapButton: HTMLButtonElement;
  #wordsButton: HTMLButtonElement;
  #notationButton: HTMLButtonElement;
  #readingStyle: ReadingStyle = loadReadingStyle();
  #buildButton: HTMLButtonElement;
  #readyButton: HTMLButtonElement;
  #panelTitle: HTMLElement;
  #summary: HTMLElement;
  #rowNodes: HTMLElement[] = [];

  /** Which line the next tap will time. */
  #cursor = 0;
  /**
   * Which *word* of that line the next tap will time, or `null` for the usual
   * line-at-a-time tapping.
   *
   * Word timing is a mode rather than a separate screen because it is the same
   * gesture on a finer grain: the track plays, you press T as things land. All
   * that changes is what a press means, so the sheet, the keys and the muscle
   * memory carry straight over.
   */
  #wordCursor: number | null = null;
  /** The word of the tap button, which changes with that mode. */
  #tapLabel: HTMLElement;
  /**
   * A one-off explanation, shown where the count usually is.
   *
   * For the cases where you asked for something and nothing happened. Doing
   * nothing silently is the worst answer available: you cannot tell a refusal
   * from a broken key.
   */
  #nudge = '';
  #sections: readonly LyricSection[] = [];
  #audioKey = '';
  #open = true;
  /** The text this panel last turned into lines, for spotting outside edits. */
  #parsedText = '';
  #lastMode = '';
  #latinLoaded = false;
  #pending = false;
  /** Whether an engine can say anything useful about this song's language. */
  #readable = false;
  /**
   * Starts empty rather than at the default language, so the first update
   * always counts as a change and actually loads the engine. Seeding it with
   * 'ko' meant it matched the default on the very first pass, the load branch
   * never ran, and no reading was ever fetched.
   */
  #language: LanguageTag | '' = '';

  constructor(store: Store, player: Player, callbacks: LyricsPanelCallbacks) {
    this.#store = store;
    this.#player = player;
    this.#callbacks = callbacks;

    this.#textarea = el('textarea', {
      class: 'lyrics__input',
      rows: '8',
      spellcheck: 'false',
      placeholder:
        '가사를 여기에 붙여넣으세요 — paste the lyrics here, one line per line.\n\nKeep the headings — [Intro: j-hope], [Chorus] — and each part becomes a button under the waveform.',
      oninput: () => this.#onPaste(),
    }) as HTMLTextAreaElement;

    this.#list = el('ol', { class: 'lyrics__lines' });

    this.#tapLabel = el('span', { class: 'lyrics__tap-label' }, 'Tap');
    this.#tapButton = el(
      'button',
      {
        class: 'lyrics__tap',
        type: 'button',
        onclick: () => this.tap(),
      },
      this.#tapLabel,
      el('kbd', {}, 'T'),
    ) as HTMLButtonElement;

    /*
     * The way into word timing.
     *
     * Its first home was a badge on each row that appeared on hover, which is
     * fine for the re-tap and clear buttons beside it — you go looking for
     * those already knowing what they do. It is useless for something nobody
     * knows exists: you cannot hover your way to a feature you have never
     * heard of. So it sits next to Tap, in the one place you are already
     * looking while timing a song, and says what key does it.
     */
    this.#wordsButton = el(
      'button',
      {
        class: 'lyrics__wordmode',
        type: 'button',
        onclick: () => {
          if (this.#wordCursor !== null) this.#exitWords();
          else this.#armWords(this.#cursor);
        },
      },
      el('span', { class: 'lyrics__wordmode-label' }, 'Words'),
      el('kbd', {}, 'W'),
    ) as HTMLButtonElement;

    /*
     * Which notation the sheet reads in.
     *
     * Labelled with what you are looking at rather than what pressing it
     * does — a button that says "IPA" while showing respellings is a riddle.
     * The tooltip carries the verb.
     */
    this.#notationButton = el(
      'button',
      {
        class: 'lyrics__notation',
        type: 'button',
        onclick: () => {
          this.#readingStyle = this.#readingStyle === 'respell' ? 'ipa' : 'respell';
          saveReadingStyle(this.#readingStyle);
          this.#renderLines();
        },
      },
    ) as HTMLButtonElement;

    this.#buildButton = el(
      'button',
      {
        class: 'lyrics__build',
        type: 'button',
        onclick: () => this.#callbacks.onBuild(),
      },
      'Build the score',
    ) as HTMLButtonElement;

    /*
     * The end of Setup.
     *
     * Pasting into a box gives no sense of having finished, so this says what
     * arrived and opens the next door in the same breath. It is the twin of
     * "Build the score" at the end of Beatmap.
     */
    this.#readyButton = el(
      'button',
      {
        class: 'lyrics__ready',
        type: 'button',
        'data-tip': 'Take these lyrics through to Beatmap\nWhere you tap each line as it lands',
        onclick: () => this.#callbacks.onLyricsReady(),
      },
      'Lyrics are in — start the beatmap →',
    ) as HTMLButtonElement;

    this.#panelTitle = el('h2', { class: 'lyrics__title' }, 'Lyric sheet');
    this.#summary = el('p', { class: 'lyrics__summary' });

    this.element = el(
      'section',
      { class: 'lyrics' },
      el(
        'header',
        { class: 'lyrics__head' },
        this.#panelTitle,
        el(
          'button',
          {
            class: 'lyrics__collapse',
            type: 'button',
            onclick: () => this.toggle(),
          },
          'Hide',
        ),
      ),
      el('div', { class: 'lyrics__body' }, this.#textarea, this.#list),
      el(
        'footer',
        { class: 'lyrics__foot' },
        this.#tapButton,
        this.#wordsButton,
        this.#notationButton,
        el(
          'button',
          { class: 'lyrics__reset', type: 'button', onclick: () => this.#resetTimings() },
          'Clear all timings',
        ),
        this.#summary,
        this.#readyButton,
        this.#buildButton,
      ),
    );

    this.#bindKeys();
  }

  toggle(): void {
    this.#open = !this.#open;
    this.element.classList.toggle('is-collapsed', !this.#open);
    const button = this.element.querySelector('.lyrics__collapse');
    if (button) button.textContent = this.#open ? 'Hide' : 'Show';
  }

  /**
   * Time the next untimed line at the current playhead.
   *
   * Tapping slightly late is the normal human error, so a small negative
   * offset is applied: you hear the line start, then react. 120 ms is about
   * the median simple reaction time, and correcting for it here saves nudging
   * every line afterwards.
   */
  tap(): void {
    if (this.#wordCursor !== null) {
      this.#tapWord();
      return;
    }

    const sheet = getSheet();
    if (sheet.lines.length === 0) return;

    this.#nudge = '';
    const at = Math.max(0, this.#player.currentTime - 0.12);
    const lines = sheet.lines.map((line, index) => {
      if (index !== this.#cursor) return line;
      /*
       * Re-timing a line carries whatever you timed inside it along by the
       * same amount.
       *
       * The words of a line keep their rhythm relative to its start; what a
       * late tap got wrong is the start, not the spacing. Dropping the word
       * times here would punish you for fixing a line — nudge one hook half a
       * second and lose the work you did inside it.
       */
      const shift = line.startSec === null ? 0 : at - line.startSec;
      const words = line.wordTimes;
      return {
        ...line,
        startSec: at,
        ...(words
          ? { wordTimes: words.map((time) => (time === null ? null : time + shift)) }
          : {}),
      };
    });

    this.#commit(lines);
    this.#cursor = Math.min(this.#cursor + 1, lines.length);
    this.#renderLines();
  }

  /**
   * Time one word of the armed line, then aim at the next one.
   *
   * The same 120 ms correction as a line tap, for the same reason: you press
   * the key after hearing the word, not as it starts.
   */
  #tapWord(): void {
    const slot = this.#wordCursor;
    const sheet = getSheet();
    const line = sheet.lines[this.#cursor];
    if (slot === null || !line) return;

    const total = wordCount(line.text);
    if (total === 0 || slot >= total) {
      this.#rollOn();
      this.#renderLines();
      return;
    }

    const at = Math.max(0, this.#player.currentTime - 0.12);
    const times = wordTimesOf(line, total);
    times[slot] = at;

    /*
     * The first word of a line is where the line begins.
     *
     * Recording it as the line's own time is what lets a word pass stand on
     * its own: you can drop into a song nobody has timed, tap every word as it
     * lands, and come out the other end with both grains done. Without it,
     * word timing could only ever be a second pass over a first one.
     */
    const opensTheLine = slot === 0;

    this.#commit(
      sheet.lines.map((entry, index) =>
        index === this.#cursor
          ? { ...entry, wordTimes: times, ...(opensTheLine ? { startSec: at } : {}) }
          : entry,
      ),
    );

    if (slot + 1 < total) this.#wordCursor = slot + 1;
    else this.#rollOn();
    this.#renderLines();
  }

  /**
   * Hand the next tap to the first word of the next line.
   *
   * The old behaviour dropped you out of word mode at the end of every line,
   * which meant timing a song word by word was really timing one line, going
   * to find the next one, and starting again — dozens of times, against a
   * track that does not stop for any of it. Words run on across the whole
   * song now; the line boundary is something the sheet knows about, not
   * something you have to do anything about.
   */
  #rollOn(): void {
    const lines = getSheet().lines;
    const next = this.#cursor + 1;
    if (next >= lines.length) {
      // The end of the song is the one place stopping is the right answer.
      this.#wordCursor = null;
      return;
    }
    this.#cursor = next;
    this.#wordCursor = 0;
  }

  /**
   * Start timing the words inside a line.
   *
   * Aims at the first word that has no time yet, so coming back to a
   * half-finished line resumes rather than starts over, and drops the playhead
   * in just before the line so the first word arrives at you instead of
   * having already gone past.
   */
  #armWords(index: number): void {
    const line = getSheet().lines[index];
    if (!line) return;

    this.#nudge = '';
    this.#cursor = index;
    const total = wordCount(line.text);
    const times = line.wordTimes ?? [];
    const firstBlank = times.findIndex((time) => time === null || time === undefined);
    this.#wordCursor =
      times.length === 0 || firstBlank < 0 ? 0 : Math.min(firstBlank, Math.max(0, total - 1));

    /*
     * Drop in just before the line when we know where it is.
     *
     * When we do not — a line nobody has timed, which word timing is now
     * allowed to start from — there is nowhere to rewind *to*. Leaving the
     * playhead alone and playing from here is the honest answer; guessing a
     * position would only send you somewhere you did not ask to go.
     */
    if (line.startSec !== null) {
      this.#player.seek(Math.max(0, line.startSec - WORD_LEAD_IN_SEC));
    }
    void this.#player.play();
    this.#renderLines();
  }

  #exitWords(): void {
    this.#wordCursor = null;
    this.#renderLines();
  }

  /** Point the next word tap at a particular word, staying inside the line. */
  #aimWord(index: number): void {
    const line = getSheet().lines[this.#cursor];
    if (!line) return;
    this.#wordCursor = Math.max(0, Math.min(index, wordCount(line.text) - 1));
    this.#renderLines();
  }

  /** Undo the last word tap: step back onto it and clear it. */
  #clearWordBack(): void {
    const slot = this.#wordCursor;
    const line = getSheet().lines[this.#cursor];
    if (slot === null || !line) return;

    const total = wordCount(line.text);
    const target = Math.max(0, slot - 1);
    const times = wordTimesOf(line, total);
    times[target] = null;

    this.#commit(
      getSheet().lines.map((entry, index) =>
        index === this.#cursor ? { ...entry, wordTimes: times } : entry,
      ),
    );
    this.#wordCursor = target;
    this.#renderLines();
  }

  /** Throw away every word time on a line, leaving the line's own tap alone. */
  #clearWords(index: number): void {
    this.#commit(
      getSheet().lines.map((line, i) => {
        if (i !== index) return line;
        const { wordTimes: _dropped, ...rest } = line;
        return rest;
      }),
    );
    this.#renderLines();
  }

  update(state: State): void {
    const audio = state.audio;
    if (!audio) return;

    const key = state.trackId ?? '';
    const sheet = getSheet();
    const sheetText = sheetToText(sheet);

    // Resync on a new track *or* whenever the sheet has been replaced beneath
    // us — opening a project file for the song already loaded changes the
    // sheet without changing the track, and keying only on the track id left
    // the panel showing the old text while the score showed the new.
    //
    // The comparison is against what this panel last *parsed*, not against the
    // sheet's line texts. Those two differ for perfectly ordinary reasons —
    // blank lines, a stray bracketed marker, trailing spaces — and treating
    // any difference as "someone else changed the sheet" is what used to make
    // the box quietly overwrite itself while you were working in it.
    const externallyChanged = sheetText !== this.#parsedText;
    const focused = document.activeElement === this.#textarea;

    if (key && (key !== this.#audioKey || (externallyChanged && !focused))) {
      this.#audioKey = key;
      this.#sections = sheet.sections ?? [];
      this.#textarea.value = sheetText;
      this.#parsedText = sheetText;
      const firstUntimed = sheet.lines.findIndex((line) => line.startSec === null);
      this.#cursor = firstUntimed < 0 ? sheet.lines.length : firstUntimed;
      this.#renderLines();
    }

    const language = state.inputLanguage === 'auto' ? sheet.language : state.inputLanguage;
    if (language !== this.#language) {
      this.#language = language;
      this.#readable = false;
      this.#latinLoaded = false;
    }
    this.#ensureEngines();

    this.#tapButton.disabled = getSheet().lines.length === 0;
    if (state.mode !== this.#lastMode) {
      this.#lastMode = state.mode;
      // Setup is nothing but the sheet, so a collapse left over from another
      // view would leave that screen empty with no way to reopen it — the
      // Hide button is not there either.
      if (state.mode === 'setup' && !this.#open) this.toggle();
      this.#updateSummary();
    }
    this.#highlightPlayhead(state.currentTime);
  }

  /**
   * Fetch whatever the sheet needs to be readable, once, in the background.
   *
   * Checked on every update rather than only when the language changes,
   * because the words arrive after the song does: a track opens empty, and
   * the English in it does not exist until you paste it.
   */
  #ensureEngines(): void {
    const language = this.#language;
    if (language === '') return;

    const latin = getSheet().lines.some((line) => needsLatinEngine(line.text, language));
    if (this.#readable && (this.#latinLoaded || !latin)) return;
    if (this.#pending) return;

    this.#pending = true;
    this.#latinLoaded = this.#latinLoaded || latin;
    // Engines can have assets to fetch — the English lexicon is megabytes —
    // so readings appear a beat after the words rather than holding up the
    // panel. A purely Korean sheet never pays for the English one at all.
    void loadReadings(language, latin)
      .then(() => {
        this.#pending = false;
        if (this.#language !== language) return;
        this.#readable = canRead(language);
        this.#renderLines();
      })
      .catch(() => {
        this.#pending = false;
      });
  }

  // -------------------------------------------------------------------------

  #onPaste(): void {
    const sheet = getSheet();
    const { lines, sections } = parseSheet(this.#textarea.value, sheet);
    this.#sections = sections;
    this.#parsedText = sheetToText({ ...sheet, lines, sections });
    this.#commit(lines);
    this.#ensureEngines();
    // Resume tapping at the first line that still needs a time.
    const firstUntimed = lines.findIndex((line) => line.startSec === null);
    this.#cursor = firstUntimed < 0 ? lines.length : firstUntimed;
    this.#renderLines();
  }

  /**
   * Point the next tap at a particular line.
   *
   * Re-timing one line in the middle of a finished sheet used to mean holding
   * the playhead in the right place and clicking a button at the exact moment
   * — two things at once, badly. Arming separates them: say which line, then
   * tap it with T like any other, as many times as it takes.
   */
  #arm(index: number, options: { rewind?: boolean } = {}): void {
    const next = Math.max(0, Math.min(index, getSheet().lines.length - 1));
    // Aiming at a different line leaves word mode: word timing belongs to one
    // line, and carrying it across would put the next tap on a word of a line
    // you are no longer looking at.
    if (next !== this.#cursor && this.#wordCursor !== null) this.#wordCursor = null;
    this.#cursor = next;
    // Whatever the explanation was about, you have moved on from it.
    this.#nudge = '';
    this.#updateSummary();

    if (!options.rewind) return;

    // Drop in a couple of seconds early so the line arrives at you, rather
    // than starting exactly on it and needing to react to a sound already
    // in progress.
    const line = getSheet().lines[this.#cursor];
    const anchor = line?.startSec ?? this.#previousTimed(this.#cursor) ?? 0;
    this.#player.seek(Math.max(0, anchor - LEAD_IN_SEC));
    void this.#player.play();
  }

  /** The most recent timed line before `index`, for a sensible rewind point. */
  #previousTimed(index: number): number | null {
    const lines = getSheet().lines;
    for (let i = index - 1; i >= 0; i -= 1) {
      const at = lines[i]?.startSec;
      if (at !== null && at !== undefined) return at;
    }
    return null;
  }

  /** Clear one line's timing, leaving every other line alone. */
  #clearLine(index: number): void {
    this.#commit(
      getSheet().lines.map((line, i) => {
        if (i !== index) return line;
        // Word times are measured from the line's own tap, so a line with no
        // tap cannot keep them. They would be absolute times pointing at a
        // place in the song this line no longer claims.
        const { wordTimes: _dropped, ...rest } = line;
        return { ...rest, startSec: null };
      }),
    );
    this.#cursor = index;
    this.#wordCursor = null;
    this.#renderLines();
  }

  /**
   * Update the sheet and persist it against this track.
   *
   * Saving is keyed on the audio fingerprint, so two songs can never write
   * over one another — and renaming a file no longer detaches its timings.
   */
  #commit(lines: LyricLine[]): void {
    const state = this.#store.state;
    const sheet: LyricSheet = {
      ...getSheet(),
      lines,
      sections: this.#sections,
      audioKey: this.#audioKey,
      language: state.inputLanguage === 'auto' ? 'ko' : state.inputLanguage,
    };
    setSheet(sheet);

    const trackId = state.trackId;
    const audio = state.audio;
    if (!trackId || !audio) return;

    // Report the write, so the toolbar can say "Saved" rather than leaving you
    // to wonder. Every tap goes through here, so the indicator tracks reality.
    this.#store.patch({ saveState: 'saving' });
    void saveTrack({
      id: trackId,
      title: audio.name.replace(/\.[^.]+$/, ''),
      fileName: audio.name,
      durationSec: audio.durationSec,
      language: sheet.language,
      mode: state.mode,
      sheet,
    })
      .then(() => this.#store.patch({ saveState: 'saved', savedAt: Date.now() }))
      .catch(() => this.#store.patch({ saveState: 'failed' }));
  }

  #resetTimings(): void {
    this.#commit(
      getSheet().lines.map((line) => {
        const { wordTimes: _dropped, ...rest } = line;
        return { ...rest, startSec: null };
      }),
    );
    this.#cursor = 0;
    this.#wordCursor = null;
    this.#renderLines();
  }

  #renderLines(): void {
    const sheet = getSheet();
    clear(this.#list);
    this.#rowNodes = [];

    let lastSection: string | undefined;

    sheet.lines.forEach((line, index) => {
      // A heading whenever the section changes, so verse and chorus are
      // visually separated rather than one undifferentiated wall of lines.
      if (line.sectionId && line.sectionId !== lastSection) {
        const section = this.#sections.find((entry) => entry.id === line.sectionId);
        if (section) {
          this.#list.appendChild(
            el(
              'li',
              { class: `lyrics__section is-${section.kind}` },
              el('span', { class: 'lyrics__section-label' }, section.name),
              section.artists.length > 0
                ? el('span', { class: 'lyrics__section-repeat' }, section.artists.join(', '))
                : null,
            ),
          );
        }
        lastSection = line.sectionId;
      }
      const time = el(
        'button',
        {
          class: 'lyrics__time',
          type: 'button',
          'data-tip':
            line.startSec === null
              ? 'Not timed yet\nAim at this line and press `T`'
              : `Play from ${formatClock(line.startSec)}`,
          onclick: () => {
            if (line.startSec !== null) this.#player.seek(line.startSec);
          },
        },
        line.startSec === null ? '––––' : formatClock(line.startSec),
      );

      // Your own translation of the line. Beyond ships none and fetches none;
      // writing it yourself is also how it sticks.
      const translation = el('input', {
        class: 'lyrics__translation',
        type: 'text',
        value: line.translation ?? '',
        placeholder: 'what it means…',
        'aria-label': `Translation for: ${line.text}`,
        onchange: (event: Event) => {
          const value = (event.target as HTMLInputElement).value.trim();
          this.#commit(
            getSheet().lines.map((entry, i) => {
              if (i !== index) return entry;
              // Clearing the box removes the key entirely rather than storing
              // an empty string, so `line.translation ? …` stays a clean test.
              const { translation: _dropped, ...rest } = entry;
              return value ? { ...rest, translation: value } : rest;
            }),
          );
        },
      }) as HTMLInputElement;

      // Every action spelled out where the action is. Hover teaches this far
      // better than a manual does, because it answers the question at the
      // moment you have it.
      const rowHint = [
        line.startSec === null
          ? 'Not timed yet'
          : `Timed at ${formatClock(line.startSec)}`,
        'Click to aim the next tap at this line',
        '`↑` `↓` move the aim · `T` times it',
        '`R` rewinds into it · `Backspace` clears it',
        '`W` times the words inside it',
      ].join('\n');

      const total = wordCount(line.text);
      const times = line.wordTimes ?? [];
      const anchored = times.filter((at) => at !== null && at !== undefined).length;
      const timingWords = this.#wordCursor !== null && index === this.#cursor;

      /*
       * The way into word timing, and a report on it.
       *
       * A long line's words are guesses spread between two taps, and the
       * guess is worst exactly where the line is longest. This says how many
       * of them have been replaced by something real, which is also the
       * answer to "is this line's highlighting going to drift?".
       */
      const wordsButton = el(
        'button',
        {
          class: `lyrics__wordsbtn${anchored > 0 ? ' is-anchored' : ''}${
            timingWords ? ' is-on' : ''
          }`,
          type: 'button',
          'data-tip': timingWords
            ? 'Stop timing words\nThe words you did are kept'
            : [
                anchored > 0
                  ? `${anchored} of ${total} words timed by hand`
                  : 'Words in this line are estimated',
                'Time them yourself: play, then press `T` as each one lands',
                'It runs on into the next line — you never have to come back',
                'and start again',
                'Same as `W` · Shift-click to clear them',
              ].join('\n'),
          onclick: (event: Event) => {
            // Shift is the way back out: throw away this line's word times and
            // let the estimate have it again.
            if ((event as MouseEvent).shiftKey) {
              this.#wordCursor = null;
              this.#clearWords(index);
            } else if (timingWords) this.#exitWords();
            else this.#armWords(index);
          },
        },
        // A count rather than a glyph: "0/6" says there are six words here and
        // none of them timed, which is the question this badge answers.
        `${anchored}/${total}`,
      ) as HTMLButtonElement;

      const row = el(
        'li',
        {
          class: `lyrics__line${line.startSec === null ? ' is-untimed' : ''}`,
          'data-tip': rowHint,
          // Clicking anywhere on the row aims the next tap at it, without
          // moving the playhead — for when you already know where you are.
          onclick: (event: Event) => {
            if ((event.target as HTMLElement).closest('button, input')) return;
            this.#arm(index);
          },
        },
        time,
        timingWords
          ? this.#renderWordChips(line, index)
          : this.#readable
            ? el(
                'span',
                { class: 'lyrics__text' },
                renderReading(readLine(line.text, this.#language || 'ko'), this.#readingStyle),
              )
            : el('span', { class: 'lyrics__text' }, line.text),
        translation,
        wordsButton,
        el(
          'button',
          {
            class: 'lyrics__retap',
            type: 'button',
            'data-tip':
              'Rewind into this line and play\n2.5s of lead-in, then press `T` as it arrives\nSame as `R`',
            onclick: () => this.#arm(index, { rewind: true }),
          },
          '⟲',
        ),
        el(
          'button',
          {
            class: 'lyrics__clearline',
            type: 'button',
            'data-tip':
              "Clear just this line's timing\nEvery other line is left alone\nSame as `Backspace`",
            onclick: () => this.#clearLine(index),
          },
          '✕',
        ),
      );

      this.#rowNodes.push(row);
      this.#list.appendChild(row);
    });

    this.#updateSummary();
  }

  /**
   * The line, broken into its words, while you are timing them.
   *
   * The break is the one the timing code already makes — whitespace — so what
   * you see is exactly what you are aiming at. Nothing is done to the pasted
   * text: the sheet keeps the line whole, and these chips are a view of it,
   * which is the whole point. Splitting the lyrics by hand to get word timing
   * would wreck the sheet you have to read afterwards.
   */
  #renderWordChips(line: LyricLine, lineIndex: number): HTMLElement {
    const words = splitWords(line.text);
    const times = line.wordTimes ?? [];
    const start = line.startSec ?? 0;

    return el(
      'span',
      { class: 'lyrics__text lyrics__words' },
      ...words.map((word, index) => {
        const at = times[index];
        const timed = at !== null && at !== undefined;
        return el(
          'button',
          {
            class: `lyrics__word${timed ? ' is-timed' : ''}${
              index === this.#wordCursor ? ' is-next' : ''
            }`,
            type: 'button',
            'data-tip': timed
              ? `Timed ${formatOffset(at - start)}s into the line\nClick to aim the next tap here`
              : 'Not timed — estimated from the words around it\nClick to aim the next tap here',
            onclick: () => {
              this.#cursor = lineIndex;
              this.#wordCursor = index;
              this.#renderLines();
            },
          },
          /*
           * The word, and how to say it.
           *
           * Word timing zooms in on one word at a time, and the first version
           * of these chips dropped the pronunciation while doing it — exactly
           * backwards. Knowing what sound to listen for is the whole reason
           * you can tap a language you do not speak, and it matters most at
           * the moment you are waiting for one specific word to arrive.
           */
          this.#readable
            ? renderReading([readWord(word, this.#language || 'ko')], this.#readingStyle)
            : el('span', { class: 'lyrics__word-text' }, word),
          el('span', { class: 'lyrics__word-at' }, timed ? formatOffset(at - start) : '·'),
        );
      }),
    );
  }

  #updateSummary(): void {
    const sheet = getSheet();
    const timed = sheet.lines.filter((line) => line.startSec !== null).length;
    const total = sheet.lines.length;

    this.#rowNodes.forEach((row, index) => row.classList.toggle('is-next', index === this.#cursor));
    this.#scrollToCursor();

    // What a tap will do, said on the button that does it. The grain changes
    // under the same key, so the key has to say which grain it is on.
    const wordMode = this.#wordCursor !== null;
    const armed = getSheet().lines[this.#cursor];

    this.#wordsButton.disabled = total === 0;
    this.#wordsButton.classList.toggle('is-on', wordMode);
    const label = this.#wordsButton.querySelector('.lyrics__wordmode-label');
    if (label) label.textContent = wordMode ? 'Done' : 'Words';
    this.#wordsButton.setAttribute(
      'data-tip',
      wordMode
        ? 'Go back to timing whole lines\nThe words you did are kept\nSame as `W`'
        : [
            'Time word by word, straight through the song',
            '`T` times each word as it lands and runs on into the next line',
            'The first word of a line sets that line’s time too, so this',
            'works on a song you have not timed at all',
          ].join('\n'),
    );

    // Only useful where there are readings to switch between.
    this.#notationButton.textContent = this.#readingStyle === 'respell' ? 'Read-along' : 'IPA';
    this.#notationButton.disabled = !this.#readable;
    this.#notationButton.setAttribute(
      'data-tip',
      this.#readable
        ? this.#readingStyle === 'respell'
          ? 'Sounds are respelled in letters you already read\nSwitch to IPA'
          : 'Sounds are written in the International Phonetic Alphabet\nSwitch to read-along spelling'
        : 'No pronunciation engine for this language yet',
    );

    this.#tapLabel.textContent = wordMode ? 'Tap word' : 'Tap';
    this.#tapButton.classList.toggle('is-words', wordMode);
    this.#tapButton.setAttribute(
      'data-tip',
      wordMode
        ? 'Time the highlighted word at the playhead\n`Backspace` steps back a word · `W` stops'
        : 'Time the aimed line at the playhead\nSame as `T`',
    );

    if (total === 0) {
      this.#summary.textContent = '';
      this.#buildButton.disabled = true;
      return;
    }
    const parts = this.#sections.length;
    const structure = parts > 0 ? ` · ${parts} part${parts === 1 ? '' : 's'}` : '';
    // Setup counts what arrived; Beatmap counts what is timed. Same line, two
    // different questions, depending on which one you are answering.
    this.#summary.textContent =
      this.#store.state.mode === 'setup'
        ? `${total} line${total === 1 ? '' : 's'}${structure}`
        : this.#nudge
          ? this.#nudge
          : wordMode && armed
            ? // Both grains at once: where you are in the line, and where the
              // line is in the song — because word timing now runs through it.
              `Word ${(this.#wordCursor ?? 0) + 1} of ${wordCount(armed.text)} · line ${
                this.#cursor + 1
              } of ${total}`
            : `${timed} of ${total} lines timed${structure}`;
    this.#summary.classList.toggle('is-nudge', this.#nudge !== '');
    this.#buildButton.disabled = timed === 0;
    this.#readyButton.disabled = total === 0;
  }

  /**
   * Keep the line you are about to tap in the middle of the list.
   *
   * While tapping you are listening, not reading — your eyes should never have
   * to hunt for where the highlight went. Centring the next line means it is
   * always in the same place on screen, and the lines around it give you the
   * context to see what is coming.
   *
   * Positions are computed against the list box rather than using
   * `scrollIntoView`, which would also scroll the panel's ancestors and jerk
   * the whole page while you are trying to keep time.
   */
  #scrollToCursor(): void {
    const row = this.#rowNodes[this.#cursor];
    if (!row) return;
    const list = this.#list;
    if (list.scrollHeight <= list.clientHeight) return;

    // Measured with rects rather than `offsetTop`, which is relative to the
    // nearest *positioned* ancestor — not necessarily the scroll container.
    // When those differ, offsetTop is wildly too large and every scroll pins
    // to the bottom of the list.
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - listRect.top - (list.clientHeight - rowRect.height) / 2;
    const target = list.scrollTop + delta;
    const top = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));

    if (Math.abs(top - list.scrollTop) < 2) return;
    list.scrollTo({ top, behavior: 'smooth' });
  }

  #highlightPlayhead(currentTime: number): void {
    const sheet = getSheet();
    let active = -1;
    sheet.lines.forEach((line, index) => {
      if (line.startSec !== null && currentTime + 0.05 >= line.startSec) active = index;
    });
    this.#rowNodes.forEach((row, index) => row.classList.toggle('is-playing', index === active));
  }

  /**
   * Keyboard, so a re-time never needs the mouse.
   *
   * Arrow keys move which line is armed, T times it, Backspace clears it.
   * Fixing line 7 of 15 becomes: arrow to it, press T when it comes round.
   */
  #bindKeys(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (this.#store.state.mode !== 'beatmap') return;
      const total = getSheet().lines.length;
      if (total === 0) return;

      switch (event.key) {
        case 't':
        case 'T':
          this.tap();
          break;
        // The same keys move the aim, at whichever grain you are working on.
        case 'ArrowUp':
          if (this.#wordCursor !== null) this.#aimWord(this.#wordCursor - 1);
          else this.#arm(this.#cursor - 1);
          break;
        case 'ArrowDown':
          if (this.#wordCursor !== null) this.#aimWord(this.#wordCursor + 1);
          else this.#arm(this.#cursor + 1);
          break;
        case 'Backspace':
        case 'Delete':
          // Inside a line, Backspace undoes the last word rather than throwing
          // away the line you are in the middle of timing.
          if (this.#wordCursor !== null) this.#clearWordBack();
          else this.#clearLine(this.#cursor);
          break;
        case 'r':
        case 'R':
          // Rewind into the armed line, ready to tap it.
          this.#arm(this.#cursor, { rewind: true });
          break;
        case 'w':
        case 'W':
          if (this.#wordCursor !== null) this.#exitWords();
          else this.#armWords(this.#cursor);
          break;
        default:
          return;
      }
      event.preventDefault();
    });
  }
}

/**
 * A line's word times as a working array of the right length.
 *
 * Lines carry no word times at all until one is tapped, and a line whose text
 * has been edited may carry the wrong number of them. Both are normalised here
 * so the tapping code can index freely without checking either case.
 */
function wordTimesOf(line: LyricLine, total: number): (number | null)[] {
  const times = new Array<number | null>(total).fill(null);
  const existing = line.wordTimes ?? [];
  for (let index = 0; index < Math.min(total, existing.length); index += 1) {
    times[index] = existing[index] ?? null;
  }
  return times;
}

/**
 * A word's time, written as its distance into the line.
 *
 * `1:24.3` for a word is precision nobody can use — what you want to know when
 * checking your own work is that the third word came in eight tenths after the
 * line did, which is a number you can compare against what you are hearing.
 */
function formatOffset(seconds: number): string {
  return `+${seconds.toFixed(1)}`;
}

/**
 * Draw a line as written text with its sound underneath, unit by unit.
 *
 * Korean and Japanese get a reading under every syllable block, because that
 * is the grain at which a sung line arrives. Latin-script words get one
 * reading for the whole word — their letters already tell you most of it, and
 * splitting "please" into six pieces would be noise rather than help.
 */
function renderReading(words: readonly WordReading[], style: ReadingStyle): HTMLElement {
  return el(
    'span',
    { class: 'reading' },
    ...words.map((word) =>
      el(
        'span',
        { class: `reading__word is-${word.script}` },
        ...word.units.map((unit) => {
          /*
           * Read-along where the engine can offer one, IPA where it cannot.
           *
           * The gap is not a failure. Latin-script words carry no respelling
           * because their letters already are one — "please" needs no help
           * being read aloud by someone reading this in English — so in
           * read-along the sensible thing under them is nothing at all.
           */
          const sound = style === 'respell' ? unit.respell : unit.ipa;
          return el(
            'span',
            { class: 'reading__unit' },
            el('span', { class: 'reading__written' }, unit.text),
            sound === ''
              ? null
              : el(
                  'span',
                  {
                    class: `reading__ipa is-${style}`,
                    // Marked as phonetic notation only when it is: a browser
                    // told this is IPA may pick a different font for it.
                    ...(style === 'ipa' ? { lang: 'und-fonipa' } : {}),
                  },
                  sound,
                ),
          );
        }),
      ),
    ),
  );
}
