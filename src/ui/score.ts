import type { State, WordRef } from '@/core/store';
import type { PhoneticScore } from '@/core/types';
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
    if (state.score !== this.#renderedScore) {
      this.#renderedScore = state.score;
      this.#build(state);
      this.#follow = true;
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
        const node = el(
          'button',
          {
            class: `score__word source-${word.source}`,
            type: 'button',
            'data-confidence': word.confidence.toFixed(2),
            title: `${word.text} · ${word.ipa}\n${describeSource(word.source)} · confidence ${(word.confidence * 100).toFixed(0)}%`,
            onclick: () => {
              this.#callbacks.onSelectWord(lineIndex, wordIndex);
              this.#callbacks.onSeek(word.startSec);
            },
          },
          el('span', { class: 'score__lyric' }, word.text),
          el('span', { class: 'score__ipa', lang: 'und-fonipa' }, word.ipa),
        );
        if (word.confidence < 0.6) node.classList.add('is-uncertain');
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
