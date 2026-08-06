import type { State, WordRef } from '@/core/store';
import type { PhoneticScore, PhoneticWord } from '@/core/types';
import { clear, el } from './dom';

/**
 * The score: lyric above, IPA beneath, line by line.
 *
 * Built once per transcription and then only re-classed on playback, because
 * rebuilding a few thousand nodes sixty times a second is how you turn a
 * beautiful idea into a stuttering one.
 */

export interface ScoreCallbacks {
  onSeek(seconds: number): void;
  onSelectWord(lineIndex: number, wordIndex: number): void;
}

export class ScoreView {
  readonly element: HTMLElement;

  #callbacks: ScoreCallbacks;
  #wordNodes: HTMLElement[][] = [];
  #lineNodes: HTMLElement[] = [];
  #renderedScore: PhoneticScore | null = null;
  #layerKey = '';
  #activeLine = -1;
  #activeWord: WordRef | null = null;
  #follow = true;

  constructor(callbacks: ScoreCallbacks) {
    this.#callbacks = callbacks;
    this.element = el('div', { class: 'score', role: 'list' });
    // Scrolling by hand means you want to read, not be dragged along.
    this.element.addEventListener('pointerdown', () => {
      this.#follow = false;
    });
  }

  set follow(value: boolean) {
    this.#follow = value;
  }

  update(state: State): void {
    // Rebuild on a new score, or when the visible layers change — both alter
    // the DOM structurally, and neither happens often enough to optimize.
    const layerKey = Object.values(state.layers).join(',');
    if (state.score !== this.#renderedScore || layerKey !== this.#layerKey) {
      const isNewScore = state.score !== this.#renderedScore;
      this.#renderedScore = state.score;
      this.#layerKey = layerKey;
      this.#build(state);
      if (isNewScore) this.#follow = true;
    }
    this.#applyPlayhead(state);
    this.#applySelection(state.selected);
  }

  // -------------------------------------------------------------------------

  #build(state: State): void {
    clear(this.element);
    this.#wordNodes = [];
    this.#lineNodes = [];
    this.#activeLine = -1;
    this.#activeWord = null;

    const score = state.score;
    if (!score) return;

    score.lines.forEach((line, lineIndex) => {
      const wordRow = el('div', { class: 'score__words' });
      const nodes: HTMLElement[] = [];

      line.words.forEach((word, wordIndex) => {
        const layers = state.layers;

        // Stacked readings of one word. The pronounced layer only appears when
        // it actually differs from the spelling — showing 노래 twice teaches
        // nothing, but showing 좋아요 above 조아요 teaches the whole rule.
        const stack: (HTMLElement | null)[] = [
          layers.written ? el('span', { class: 'score__lyric' }, word.text) : null,
          layers.pronounced && word.changed && word.pronouncedForm
            ? el('span', { class: 'score__spoken' }, word.pronouncedForm)
            : null,
          layers.ipa ? el('span', { class: 'score__ipa', lang: 'und-fonipa' }, word.ipa) : null,
          layers.respelling && word.respelling
            ? el('span', { class: 'score__respell' }, word.respelling)
            : null,
        ];

        const node = el(
          'button',
          {
            class: `score__word source-${word.source}`,
            type: 'button',
            'data-confidence': word.confidence.toFixed(2),
            title: this.#tooltip(word),
            onclick: () => {
              this.#callbacks.onSelectWord(lineIndex, wordIndex);
              this.#callbacks.onSeek(word.startSec);
            },
          },
          ...stack.filter((part): part is HTMLElement => part !== null),
        );
        if (word.confidence < 0.6) node.classList.add('is-uncertain');
        // A word whose sound departs from its spelling is the teachable one.
        if (word.changed) node.classList.add('is-changed');
        nodes.push(node);
        wordRow.appendChild(node);
      });

      const lineNode = el(
        'section',
        { class: 'score__line', role: 'listitem', 'data-line': String(lineIndex) },
        el(
          'button',
          {
            class: 'score__timecode',
            type: 'button',
            title: 'Play from here',
            onclick: () => this.#callbacks.onSeek(line.startSec),
          },
          formatTimecode(line.startSec),
        ),
        wordRow,
        line.translation ? el('p', { class: 'score__translation' }, line.translation) : null,
      );

      this.#wordNodes.push(nodes);
      this.#lineNodes.push(lineNode);
      this.element.appendChild(lineNode);
    });
  }

  /** Everything known about a word, for the hover tooltip. */
  #tooltip(word: PhoneticWord): string {
    const rows = [`${word.text}  ·  ${word.ipa}`];
    if (word.changed && word.pronouncedForm) {
      rows.push(`written ${word.text} → said ${word.pronouncedForm}`);
    }
    if (word.respelling) rows.push(word.respelling);
    for (const note of word.notes ?? []) {
      rows.push(`${note.label} — ${note.explanation}`);
    }
    rows.push(`${describeSource(word.source)} · ${(word.confidence * 100).toFixed(0)}%`);
    return rows.join('\n');
  }

  #applyPlayhead(state: State): void {
    const score = state.score;
    if (!score) return;

    let lineIndex = -1;
    let wordRef: WordRef | null = null;

    for (const [li, line] of score.lines.entries()) {
      if (state.currentTime + 0.05 >= line.startSec) lineIndex = li;
      if (state.currentTime < line.startSec || state.currentTime > line.endSec + 0.2) continue;
      for (const [wi, word] of line.words.entries()) {
        if (state.currentTime >= word.startSec && state.currentTime <= word.endSec) {
          wordRef = { lineIndex: li, wordIndex: wi };
          break;
        }
      }
    }

    if (lineIndex !== this.#activeLine) {
      this.#lineNodes[this.#activeLine]?.classList.remove('is-active');
      this.#lineNodes[lineIndex]?.classList.add('is-active');
      this.#activeLine = lineIndex;
      if (this.#follow && state.playing) {
        this.#lineNodes[lineIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (
      wordRef?.lineIndex !== this.#activeWord?.lineIndex ||
      wordRef?.wordIndex !== this.#activeWord?.wordIndex
    ) {
      if (this.#activeWord) {
        this.#wordNodes[this.#activeWord.lineIndex]?.[this.#activeWord.wordIndex]?.classList.remove(
          'is-singing',
        );
      }
      if (wordRef) {
        this.#wordNodes[wordRef.lineIndex]?.[wordRef.wordIndex]?.classList.add('is-singing');
      }
      this.#activeWord = wordRef;
    }
  }

  #applySelection(selected: WordRef | null): void {
    for (const row of this.#wordNodes) {
      for (const node of row) node.classList.remove('is-selected');
    }
    if (!selected) return;
    this.#wordNodes[selected.lineIndex]?.[selected.wordIndex]?.classList.add('is-selected');
  }
}

export function describeSource(source: string): string {
  switch (source) {
    case 'lexicon':
      return 'From the pronouncing dictionary';
    case 'lexicon-inflected':
      return 'Built from a dictionary stem';
    case 'derived':
      return 'Derived by the standard pronunciation rules';
    case 'rules':
      return 'Guessed by letter-to-sound rules';
    case 'user':
      return 'Corrected by you';
    default:
      return 'No phonetic engine for this language yet';
  }
}

function formatTimecode(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
