import type { State } from '@/core/store';
import type { PhoneticWord, Syllable } from '@/core/types';
import { splitIpaGlyphs } from '@/phonetics/ipa';
import { vowelHue, vowelPosition } from '@/phonetics/vowelspace';
import { clear, el } from './dom';
import { describeSource } from './score';

/**
 * The inspector: one word, taken apart.
 *
 * A phonetic transcription is only useful if you can interrogate it — which
 * syllable carries the stress, which vowel is that exactly, and did the machine
 * actually know this word or was it guessing. All three are visible here.
 */
export class InspectorView {
  readonly element: HTMLElement;
  #lastKey = '';

  constructor() {
    this.element = el('aside', { class: 'inspector', 'aria-live': 'polite' });
    this.#renderEmpty();
  }

  update(state: State): void {
    const word = state.selected
      ? (state.score?.lines[state.selected.lineIndex]?.words[state.selected.wordIndex] ?? null)
      : null;

    const key = word ? `${state.selected?.lineIndex}:${state.selected?.wordIndex}:${word.ipa}` : '';
    if (key === this.#lastKey) return;
    this.#lastKey = key;

    if (!word) {
      this.#renderEmpty();
      return;
    }
    this.#renderWord(word);
  }

  #renderEmpty(): void {
    clear(this.element);
    this.element.appendChild(
      el(
        'div',
        { class: 'inspector__empty' },
        el('p', { class: 'inspector__hint' }, 'Select a word'),
        el(
          'p',
          { class: 'inspector__hint-sub' },
          'Pick a notehead on the staff or a word in the score to see its syllables, stress, and where the pronunciation came from.',
        ),
      ),
    );
  }

  #renderWord(word: PhoneticWord): void {
    clear(this.element);

    const parts: (HTMLElement | null)[] = [
      el(
        'header',
        { class: 'inspector__head' },
        el('h2', { class: 'inspector__word' }, word.text),
        el('p', { class: 'inspector__ipa', lang: 'und-fonipa' }, `/${word.ipa}/`),
      ),

      el(
        'div',
        { class: 'inspector__meta' },
        badge(describeSource(word.source), word.source),
        badge(`${(word.confidence * 100).toFixed(0)}% confident`, confidenceTone(word.confidence)),
        badge(`${(word.endSec - word.startSec).toFixed(2)}s`, 'neutral'),
      ),

      section('Syllables', this.#syllables(word)),
      section('Segments', this.#segments(word)),
      word.variants && word.variants.length > 0
        ? section('Also pronounced', this.#variants(word.variants))
        : null,
    ];

    this.element.append(...parts.filter((part): part is HTMLElement => part !== null));
  }

  #syllables(word: PhoneticWord): HTMLElement {
    const row = el('div', { class: 'syllables' });
    word.syllables.forEach((syllable, index) => {
      if (index > 0) row.appendChild(el('span', { class: 'syllables__dot' }, '·'));
      row.appendChild(this.#syllable(syllable));
    });
    return row;
  }

  #syllable(syllable: Syllable): HTMLElement {
    const stressClass =
      syllable.stress === 1 ? 'is-primary' : syllable.stress === 2 ? 'is-secondary' : '';
    return el(
      'span',
      { class: `syllable ${stressClass}` },
      // Onset / nucleus / coda are coloured separately: the nucleus is the part
      // that gets sustained, and seeing it isolated is half of diction practice.
      syllable.onset.length > 0
        ? el('span', { class: 'syllable__onset' }, syllable.onset.map((p) => p.ipa).join(''))
        : null,
      el(
        'span',
        {
          class: 'syllable__nucleus',
          style: `--vowel-hue:${vowelHue(syllable.nucleus[0]?.ipa ?? 'ə')}`,
        },
        syllable.nucleus.map((p) => p.ipa).join(''),
      ),
      syllable.coda.length > 0
        ? el('span', { class: 'syllable__coda' }, syllable.coda.map((p) => p.ipa).join(''))
        : null,
    );
  }

  #segments(word: PhoneticWord): HTMLElement {
    const grid = el('div', { class: 'segments' });
    for (const phone of word.phones) {
      const glyphs = splitIpaGlyphs(phone.ipa).join('');
      const detail = phone.isVowel ? describeVowel(phone.ipa) : 'consonant';
      grid.appendChild(
        el(
          'div',
          {
            class: `segment ${phone.isVowel ? 'is-vowel' : 'is-consonant'}`,
            style: phone.isVowel ? `--vowel-hue:${vowelHue(phone.ipa)}` : '',
            title: `${glyphs} — ${detail}${phone.native ? ` (${phone.native})` : ''}`,
          },
          el('span', { class: 'segment__glyph', lang: 'und-fonipa' }, glyphs),
          el('span', { class: 'segment__label' }, phone.native ?? detail),
        ),
      );
    }
    return grid;
  }

  #variants(variants: readonly string[]): HTMLElement {
    return el(
      'ul',
      { class: 'variants' },
      ...variants.map((variant) =>
        el('li', { class: 'variants__item', lang: 'und-fonipa' }, `/${variant}/`),
      ),
    );
  }
}

function section(title: string, body: HTMLElement): HTMLElement {
  return el(
    'section',
    { class: 'inspector__section' },
    el('h3', { class: 'inspector__title' }, title),
    body,
  );
}

function badge(text: string, tone: string): HTMLElement {
  return el('span', { class: `badge badge--${tone}` }, text);
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.85) return 'good';
  if (confidence >= 0.6) return 'fair';
  return 'poor';
}

/** Plain-language gloss of a vowel's position, for people who do not read IPA yet. */
function describeVowel(ipa: string): string {
  const { height, backness, rounded } = vowelPosition(ipa);
  const heightWord =
    height >= 0.85 ? 'close' : height >= 0.6 ? 'close-mid' : height >= 0.45 ? 'mid' : height >= 0.3 ? 'open-mid' : 'open';
  const backnessWord = backness <= 0.33 ? 'front' : backness <= 0.66 ? 'central' : 'back';
  return `${heightWord} ${backnessWord}${rounded ? ' rounded' : ''} vowel`;
}
