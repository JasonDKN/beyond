import type { State } from '@/core/store';
import type { PhoneticWord, Syllable } from '@/core/types';
import { Glossary } from '@/korean/morphology';
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
  readonly #glossary = new Glossary();

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

      word.morphemes?.length ? section('Grammar', this.#morphemes(word)) : null,
      this.#glossarySection(word),
      section('Syllables', this.#syllables(word)),
      section('Segments', this.#segments(word)),
      word.variants && word.variants.length > 0
        ? section('Also pronounced', this.#variants(word.variants))
        : null,
    ];

    this.element.append(...parts.filter((part): part is HTMLElement => part !== null));
  }

  /**
   * The word taken apart into stem plus grammar.
   *
   * This is where the transferable learning is. Knowing what one line means
   * teaches you that line; recognising -었- as past tense teaches you every
   * past tense you will ever hear.
   */
  #morphemes(word: PhoneticWord): HTMLElement {
    const list = el('div', { class: 'morphemes' });
    for (const morpheme of word.morphemes ?? []) {
      list.appendChild(
        el(
          'div',
          {
            class: `morpheme morpheme--${morpheme.kind}`,
            ...(morpheme.detail ? { title: morpheme.detail } : {}),
          },
          el('span', { class: 'morpheme__text' }, morpheme.text),
          el(
            'span',
            { class: 'morpheme__gloss' },
            morpheme.gloss || (morpheme.kind === 'stem' ? this.#stemGloss(morpheme.text) : ''),
          ),
        ),
      );
    }
    return list;
  }

  #stemGloss(stem: string): string {
    return this.#glossary.get(stem) ?? '—';
  }

  /**
   * Your own glossary.
   *
   * The analyser names the grammar but leaves open-class stems alone, because
   * glossing those needs a dictionary too large to ship in a browser tab. So
   * you fill them in — which is the better way round anyway: a word you looked
   * up because it appeared in a song you like is a word you keep.
   */
  #glossarySection(word: PhoneticWord): HTMLElement {
    const stem = word.morphemes?.[0]?.text ?? word.normalized;
    const input = el('input', {
      class: 'glossary__input',
      type: 'text',
      value: this.#glossary.get(stem) ?? '',
      placeholder: `what does ${stem} mean?`,
      'aria-label': `Your meaning for ${stem}`,
      onchange: (event: Event) => {
        this.#glossary.set(stem, (event.target as HTMLInputElement).value);
        const gloss = this.element.querySelector('.morpheme--stem .morpheme__gloss');
        if (gloss) gloss.textContent = this.#glossary.get(stem) ?? '—';
      },
    });

    return el(
      'section',
      { class: 'inspector__section' },
      el('h3', { class: 'inspector__title' }, 'Your note'),
      input,
      el(
        'p',
        { class: 'glossary__hint' },
        `${this.#glossary.size} word${this.#glossary.size === 1 ? '' : 's'} saved · exportable as TSV for Anki`,
      ),
    );
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
