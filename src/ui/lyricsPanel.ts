import type { Player } from '@/audio/player';
import type { State, Store } from '@/core/store';
import {
  audioKeyFor,
  getSheet,
  loadSheet,
  parseLyrics,
  saveSheet,
  setSheet,
  type LyricLine,
} from '@/transcription/providers/lyrics';
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
          { class: 'lyrics__reset', type: 'button', onclick: () => this.#resetTimings() },
          'Clear timings',
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

    const key = audioKeyFor(audio.name, audio.durationSec);
    if (key !== this.#audioKey) {
      this.#audioKey = key;
      const saved = loadSheet(key);
      if (saved) {
        setSheet(saved);
        this.#textarea.value = saved.lines.map((line) => line.text).join('\n');
        this.#cursor = saved.lines.findIndex((line) => line.startSec === null);
        if (this.#cursor < 0) this.#cursor = saved.lines.length;
      } else {
        setSheet({ language: state.inputLanguage === 'auto' ? 'ko' : state.inputLanguage, lines: [], audioKey: key });
        this.#cursor = 0;
      }
      this.#renderLines();
    }

    this.#tapButton.disabled = getSheet().lines.length === 0;
    this.#highlightPlayhead(state.currentTime);
  }

  // -------------------------------------------------------------------------

  #onPaste(): void {
    const sheet = getSheet();
    const lines = parseLyrics(this.#textarea.value, sheet);
    this.#commit(lines);
    // Resume tapping at the first line that still needs a time.
    const firstUntimed = lines.findIndex((line) => line.startSec === null);
    this.#cursor = firstUntimed < 0 ? lines.length : firstUntimed;
    this.#renderLines();
  }

  #commit(lines: LyricLine[]): void {
    const sheet = {
      ...getSheet(),
      lines,
      audioKey: this.#audioKey,
      language: this.#store.state.inputLanguage === 'auto' ? 'ko' : this.#store.state.inputLanguage,
    };
    setSheet(sheet);
    saveSheet(sheet);
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

    sheet.lines.forEach((line, index) => {
      const time = el(
        'button',
        {
          class: 'lyrics__time',
          type: 'button',
          title: line.startSec === null ? 'Not timed yet' : 'Play from here',
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

      const row = el(
        'li',
        { class: `lyrics__line${line.startSec === null ? ' is-untimed' : ''}` },
        time,
        el('span', { class: 'lyrics__text' }, line.text),
        translation,
        el(
          'button',
          {
            class: 'lyrics__retap',
            type: 'button',
            title: 'Re-time this line at the playhead',
            onclick: () => {
              this.#cursor = index;
              this.tap();
            },
          },
          '⟲',
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

    if (total === 0) {
      this.#summary.textContent = '';
      this.#buildButton.disabled = true;
      return;
    }
    this.#summary.textContent = `${timed} of ${total} lines timed`;
    this.#buildButton.disabled = timed === 0;
  }

  #highlightPlayhead(currentTime: number): void {
    const sheet = getSheet();
    let active = -1;
    sheet.lines.forEach((line, index) => {
      if (line.startSec !== null && currentTime + 0.05 >= line.startSec) active = index;
    });
    this.#rowNodes.forEach((row, index) => row.classList.toggle('is-playing', index === active));
  }

  #bindKeys(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key !== 't' && event.key !== 'T') return;
      event.preventDefault();
      this.tap();
    });
  }
}
