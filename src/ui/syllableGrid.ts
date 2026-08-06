import type { State } from '@/core/store';
import type { PhoneticLine, PhoneticWord, Syllable } from '@/core/types';
import { clear, el } from './dom';

/**
 * The syllable grid — where the beats actually land.
 *
 * Korean is syllable-timed: every Hangul block gets roughly equal duration,
 * and one block is one rhythmic slot. That is precisely what makes Korean rap
 * feel impossible to an English speaker and then suddenly easy — English is
 * stress-timed, so an English speaker instinctively crushes the syllables
 * between stresses, which in Korean is exactly the wrong instinct.
 *
 * Seeing the syllables as equal cells, sweeping in time, retrains that. It is
 * the difference between "this is too fast" and "there are eleven of them and
 * they are evenly spaced".
 */
export class SyllableGridView {
  readonly element: HTMLElement;

  #track: HTMLElement;
  #label: HTMLElement;
  #cells: { node: HTMLElement; startSec: number; endSec: number }[] = [];
  #renderedLineId: string | null = null;
  #activeIndex = -1;
  #onSeek: (seconds: number) => void;

  constructor(onSeek: (seconds: number) => void) {
    this.#onSeek = onSeek;
    this.#label = el('span', { class: 'grid__label' }, 'Syllables');
    this.#track = el('div', { class: 'grid__track' });
    this.element = el(
      'section',
      { class: 'grid', 'aria-label': 'Syllable timing for the current line' },
      el('header', { class: 'grid__head' }, this.#label),
      this.#track,
    );
  }

  update(state: State): void {
    const line = activeLine(state);
    if (!line) {
      if (this.#renderedLineId !== null) {
        this.#renderedLineId = null;
        clear(this.#track);
        this.#cells = [];
        this.element.classList.add('is-empty');
      }
      return;
    }

    if (line.id !== this.#renderedLineId) {
      this.#renderedLineId = line.id;
      this.#build(line);
      this.element.classList.remove('is-empty');
    }

    this.#sweep(state.currentTime);
  }

  #build(line: PhoneticLine): void {
    clear(this.#track);
    this.#cells = [];
    this.#activeIndex = -1;

    const syllables = flattenSyllables(line);
    this.#label.textContent = `${syllables.length} syllables · ${(line.endSec - line.startSec).toFixed(1)}s`;

    for (const entry of syllables) {
      const node = el(
        'button',
        {
          class: 'grid__cell',
          type: 'button',
          title: `${entry.ipa} — ${entry.startSec.toFixed(2)}s`,
          onclick: () => this.#onSeek(entry.startSec),
        },
        el('span', { class: 'grid__glyph' }, entry.glyph),
        el('span', { class: 'grid__ipa', lang: 'und-fonipa' }, entry.ipa),
      );
      // Width proportional to duration, so an held syllable reads as held.
      const share = (entry.endSec - entry.startSec) / Math.max(0.001, line.endSec - line.startSec);
      node.style.flexGrow = String(Math.max(0.4, share * syllables.length));
      if (entry.wordStart) node.classList.add('is-word-start');

      this.#cells.push({ node, startSec: entry.startSec, endSec: entry.endSec });
      this.#track.appendChild(node);
    }
  }

  #sweep(currentTime: number): void {
    const index = this.#cells.findIndex(
      (cell) => currentTime >= cell.startSec && currentTime < cell.endSec,
    );
    if (index === this.#activeIndex) return;
    this.#cells[this.#activeIndex]?.node.classList.remove('is-on');
    this.#cells[index]?.node.classList.add('is-on');
    this.#activeIndex = index;
  }
}

interface GridSyllable {
  readonly glyph: string;
  readonly ipa: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly wordStart: boolean;
}

/**
 * Flatten a line to syllables with timings.
 *
 * Where the language's own script is syllabic — Hangul, kana — each written
 * character is shown in its own cell, because that is the unit the singer
 * reads. Otherwise the cell falls back to the syllable's IPA.
 */
function flattenSyllables(line: PhoneticLine): GridSyllable[] {
  const out: GridSyllable[] = [];

  for (const word of line.words) {
    const glyphs = syllabicGlyphs(word);
    word.syllables.forEach((syllable, index) => {
      const timing = syllableTiming(syllable, word, index);
      out.push({
        glyph: glyphs[index] ?? syllableIpa(syllable),
        ipa: syllableIpa(syllable),
        startSec: timing.startSec,
        endSec: timing.endSec,
        wordStart: index === 0,
      });
    });
  }

  return out;
}

/** Hangul blocks, one per syllable, when the word is written in Hangul. */
function syllabicGlyphs(word: PhoneticWord): string[] {
  const source = word.pronouncedForm ?? word.text;
  const blocks = [...source].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0xac00 && code <= 0xd7a3;
  });
  return blocks.length === word.syllables.length ? blocks : [];
}

function syllableIpa(syllable: Syllable): string {
  return [...syllable.onset, ...syllable.nucleus, ...syllable.coda].map((p) => p.ipa).join('');
}

/**
 * Timing for one syllable. Phones carry their own times once the pipeline has
 * distributed a word's duration, so prefer those; fall back to an even split
 * of the word when they are absent.
 */
function syllableTiming(
  syllable: Syllable,
  word: PhoneticWord,
  index: number,
): { startSec: number; endSec: number } {
  const phones = [...syllable.onset, ...syllable.nucleus, ...syllable.coda];
  const start = phones.find((phone) => phone.startSec !== undefined)?.startSec;
  const end = [...phones].reverse().find((phone) => phone.endSec !== undefined)?.endSec;

  if (start !== undefined && end !== undefined && end > start) {
    return { startSec: start, endSec: end };
  }

  const span = (word.endSec - word.startSec) / Math.max(1, word.syllables.length);
  return {
    startSec: word.startSec + index * span,
    endSec: word.startSec + (index + 1) * span,
  };
}

function activeLine(state: State): PhoneticLine | null {
  const score = state.score;
  if (!score || score.lines.length === 0) return null;
  let best: PhoneticLine | null = null;
  for (const line of score.lines) {
    if (state.currentTime + 0.05 >= line.startSec) best = line;
  }
  // Before the first line starts — which is where the playhead sits the moment
  // a score is built — show the opening line rather than an empty strip. An
  // empty panel reads as broken; the first line reads as ready.
  return best ?? score.lines[0]!;
}
