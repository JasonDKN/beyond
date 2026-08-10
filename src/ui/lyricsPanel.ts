import type { Player } from '@/audio/player';
import type { State, Store } from '@/core/store';
import { saveTrack } from '@/storage/library';
import {
  getSheet,
  parseSheet,
  setSheet,
  sheetToText,
  suggestSections,
  type LyricLine,
  type LyricSection,
  type LyricSheet,
} from '@/transcription/providers/lyrics';

/** How far before a line to rewind when you ask to re-time it. */
const LEAD_IN_SEC = 2.5;
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
}

export class LyricsPanelView {
  readonly element: HTMLElement;

  #store: Store;
  #player: Player;
  #callbacks: LyricsPanelCallbacks;

  #textarea: HTMLTextAreaElement;
  #list: HTMLElement;
  #tapButton: HTMLButtonElement;
  #buildButton: HTMLButtonElement;
  #summary: HTMLElement;
  #rowNodes: HTMLElement[] = [];

  /** Which line the next tap will time. */
  #cursor = 0;
  #sections: readonly LyricSection[] = [];
  #audioKey = '';
  #open = true;

  constructor(store: Store, player: Player, callbacks: LyricsPanelCallbacks) {
    this.#store = store;
    this.#player = player;
    this.#callbacks = callbacks;

    this.#textarea = el('textarea', {
      class: 'lyrics__input',
      rows: '8',
      spellcheck: 'false',
      placeholder:
        '가사를 여기에 붙여넣으세요 — paste the lyrics here, one line per line.\n\nSection markers like [Verse 1] are ignored.',
      oninput: () => this.#onPaste(),
    }) as HTMLTextAreaElement;

    this.#list = el('ol', { class: 'lyrics__lines' });

    this.#tapButton = el(
      'button',
      {
        class: 'lyrics__tap',
        type: 'button',
        onclick: () => this.tap(),
      },
      'Tap',
      el('kbd', {}, 'T'),
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

    this.#summary = el('p', { class: 'lyrics__summary' });

    this.element = el(
      'section',
      { class: 'lyrics' },
      el(
        'header',
        { class: 'lyrics__head' },
        el('h2', { class: 'lyrics__title' }, 'Lyric sheet'),
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
        el(
          'button',
          {
            class: 'lyrics__reset',
            type: 'button',
            title: 'Add [Verse] and [Chorus] headings by finding the lines that repeat',
            onclick: () => this.#detectSections(),
          },
          'Detect sections',
        ),
        el(
          'button',
          { class: 'lyrics__reset', type: 'button', onclick: () => this.#resetTimings() },
          'Clear all timings',
        ),
        this.#summary,
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
    const sheet = getSheet();
    if (sheet.lines.length === 0) return;

    const at = Math.max(0, this.#player.currentTime - 0.12);
    const lines = sheet.lines.map((line, index) =>
      index === this.#cursor ? { ...line, startSec: at } : line,
    );

    this.#commit(lines);
    this.#cursor = Math.min(this.#cursor + 1, lines.length);
    this.#renderLines();
  }

  update(state: State): void {
    const audio = state.audio;
    if (!audio) return;

    const key = state.trackId ?? '';
    const sheet = getSheet();
    // Compared against the sheet written back out *with* its headings. Using
    // the bare line texts here meant a sheet with sections never matched the
    // box, so this branch fired on every state change and quietly replaced
    // what you typed with a headingless copy — taking the sections with it.
    const sheetText = sheetToText(sheet);

    // Resync on a new track *or* whenever the sheet has been replaced beneath
    // us — opening a project file for the song already loaded changes the
    // sheet without changing the track, and keying only on the track id left
    // the panel showing the old text while the score showed the new.
    //
    // Never while you are typing in the box, which would fight the edit.
    const externallyChanged = sheetText !== this.#textarea.value;
    const focused = document.activeElement === this.#textarea;

    if (key && (key !== this.#audioKey || (externallyChanged && !focused))) {
      this.#audioKey = key;
      this.#sections = sheet.sections ?? [];
      this.#textarea.value = sheetText;
      const firstUntimed = sheet.lines.findIndex((line) => line.startSec === null);
      this.#cursor = firstUntimed < 0 ? sheet.lines.length : firstUntimed;
      this.#renderLines();
    }

    this.#tapButton.disabled = getSheet().lines.length === 0;
    this.#highlightPlayhead(state.currentTime);
  }

  // -------------------------------------------------------------------------

  #onPaste(): void {
    const sheet = getSheet();
    const { lines, sections } = parseSheet(this.#textarea.value, sheet);
    this.#sections = sections;
    this.#commit(lines);
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
    this.#cursor = Math.max(0, Math.min(index, getSheet().lines.length - 1));
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
      getSheet().lines.map((line, i) => (i === index ? { ...line, startSec: null } : line)),
    );
    this.#cursor = index;
    this.#renderLines();
  }

  /** Rewrite the textarea with detected section headings. */
  #detectSections(): void {
    const sheet = getSheet();
    if (sheet.lines.length === 0) return;
    const suggested = suggestSections(sheet.lines.map((line) => line.text));
    this.#textarea.value = suggested.join('\n');
    this.#onPaste();
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
    this.#commit(getSheet().lines.map((line) => ({ ...line, startSec: null })));
    this.#cursor = 0;
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
              el('span', { class: 'lyrics__section-label' }, section.label),
              section.repeatOf
                ? el('span', { class: 'lyrics__section-repeat' }, 'repeat — words copied')
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
          title:
            line.startSec === null
              ? 'Not timed yet — aim at this line and press T'
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
        line.startSec === null ? 'Not timed yet.' : `Timed at ${formatClock(line.startSec)}.`,
        'Click to aim the next tap at this line.',
        '↑ ↓ move the aim · T times it · R rewinds into it · Backspace clears it.',
      ].join('\n');

      const row = el(
        'li',
        {
          class: `lyrics__line${line.startSec === null ? ' is-untimed' : ''}`,
          title: rowHint,
          // Clicking anywhere on the row aims the next tap at it, without
          // moving the playhead — for when you already know where you are.
          onclick: (event: Event) => {
            if ((event.target as HTMLElement).closest('button, input')) return;
            this.#arm(index);
          },
        },
        time,
        el('span', { class: 'lyrics__text' }, line.text),
        translation,
        el(
          'button',
          {
            class: 'lyrics__retap',
            type: 'button',
            title:
              'Rewind 2.5s before this line and play (R)\nThen press T as the line arrives',
            onclick: () => this.#arm(index, { rewind: true }),
          },
          '⟲',
        ),
        el(
          'button',
          {
            class: 'lyrics__clearline',
            type: 'button',
            title: "Clear just this line's timing (Backspace)\nEvery other line is left alone",
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

  #updateSummary(): void {
    const sheet = getSheet();
    const timed = sheet.lines.filter((line) => line.startSec !== null).length;
    const total = sheet.lines.length;

    this.#rowNodes.forEach((row, index) => row.classList.toggle('is-next', index === this.#cursor));
    this.#scrollToCursor();

    if (total === 0) {
      this.#summary.textContent = '';
      this.#buildButton.disabled = true;
      return;
    }
    this.#summary.textContent = `${timed} of ${total} lines timed`;
    this.#buildButton.disabled = timed === 0;
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
      if (this.#store.state.mode !== 'annotation') return;
      const total = getSheet().lines.length;
      if (total === 0) return;

      switch (event.key) {
        case 't':
        case 'T':
          this.tap();
          break;
        case 'ArrowUp':
          this.#arm(this.#cursor - 1);
          break;
        case 'ArrowDown':
          this.#arm(this.#cursor + 1);
          break;
        case 'Backspace':
        case 'Delete':
          this.#clearLine(this.#cursor);
          break;
        case 'r':
        case 'R':
          // Rewind into the armed line, ready to tap it.
          this.#arm(this.#cursor, { rewind: true });
          break;
        default:
          return;
      }
      event.preventDefault();
    });
  }
}
