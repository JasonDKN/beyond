import type { State, WordRef } from '@/core/store';
import type { PhoneticScore, PhoneticWord } from '@/core/types';
import { clear, el } from './dom';
import { FollowGuard } from './follow';
import { visibleLayers, type LayerKind } from './layers';

const LAYER_CLASS: Record<LayerKind, string> = {
  written: 'score__lyric',
  spoken: 'score__spoken',
  ipa: 'score__ipa',
  respelling: 'score__respell',
};

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
  /** The reader has deliberately scrolled away; stop following for now. */
  onFollowPause(): void;
  /** The song has caught up to where the reader is looking; follow again. */
  onFollowResume(): void;
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

  /** The element that actually scrolls; supplied by the app shell. */
  #scroller: HTMLElement | null = null;
  /**
   * Who caused the last scroll, and whether they meant it.
   *
   * See `follow.ts` — a `scroll` event alone cannot tell the reader's swipe
   * from our own animation, a phone's momentum, or the browser bringing a
   * focused button into view, and treating them all alike is what made
   * follow-along switch itself off for no visible reason.
   */
  #guard = new FollowGuard();

  constructor(callbacks: ScoreCallbacks) {
    this.#callbacks = callbacks;
    this.element = el('div', { class: 'score', role: 'list' });
  }

  /**
   * Watch the scroll container so a hand scroll can pause follow-along.
   *
   * Clicking a word deliberately does *not* pause it — inspecting a word is
   * something you do while following along, and treating a click as "stop
   * following" is what made this behave unpredictably before.
   */
  attachScroller(scroller: HTMLElement): void {
    this.#scroller = scroller;
    this.#guard.reset(scroller.scrollTop);

    // What the reader does with their hands. A scroll with none of these
    // behind it belongs to the browser, and says nothing about intent.
    const gesture = (): void => this.#guard.input(performance.now());
    for (const kind of ['wheel', 'touchstart', 'touchmove', 'pointerdown'] as const) {
      scroller.addEventListener(kind, gesture, { passive: true });
    }
    // Keys that scroll, and only those: typing in the translation box beside
    // the score is not a request to stop following along.
    const SCROLL_KEYS = new Set([
      'PageUp',
      'PageDown',
      'Home',
      'End',
      'ArrowUp',
      'ArrowDown',
      ' ',
    ]);
    scroller.addEventListener('keydown', (event) => {
      if (SCROLL_KEYS.has((event as KeyboardEvent).key)) gesture();
    });

    scroller.addEventListener(
      'scroll',
      () => {
        const verdict = this.#guard.scrolled(
          scroller.scrollTop,
          performance.now(),
          this.#follow,
          scroller.clientHeight,
        );
        if (verdict === 'pause') this.#callbacks.onFollowPause();
      },
      { passive: true },
    );
  }

  set follow(value: boolean) {
    if (value && !this.#follow) this.#rearm();
    this.#follow = value;
  }

  /**
   * Forget how far the reader had scrolled.
   *
   * Whenever following starts afresh — a new song, a new score, or the Follow
   * button pressed — the distance travelled during the last gesture stops
   * being evidence of anything. Carrying it over would let one old swipe
   * switch follow straight back off.
   */
  #rearm(): void {
    if (this.#scroller) this.#guard.reset(this.#scroller.scrollTop);
  }

  update(state: State): void {
    if (state.followScore && !this.#follow) this.#rearm();
    this.#follow = state.followScore;

    // Rebuild on a new score, or when the visible layers change — both alter
    // the DOM structurally, and neither happens often enough to optimize.
    const layerKey = Object.values(state.layers).join(',');
    if (state.score !== this.#renderedScore || layerKey !== this.#layerKey) {
      this.#renderedScore = state.score;
      this.#layerKey = layerKey;
      this.#build(state);
      // A rebuilt list is a different height, so the browser may move the
      // scroll position on its own. That is not the reader scrolling.
      this.#rearm();
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

        // Stacked readings of one word — see visibleLayers for which appear
        // and, more importantly, why one of them used to appear as nothing.
        const stack = visibleLayers(word, layers).map((line) =>
          el(
            'span',
            {
              class: LAYER_CLASS[line.kind],
              ...(line.kind === 'ipa' ? { lang: 'und-fonipa' } : {}),
            },
            line.text,
          ),
        );

        const node = el(
          'button',
          {
            class: `score__word source-${word.source}`,
            type: 'button',
            'data-confidence': word.confidence.toFixed(2),
            'data-tip': this.#tooltip(word),
            onclick: () => {
              // Clicking a button focuses it, and focusing something near the
              // edge of the viewport makes the browser scroll it into view.
              // That scroll is a consequence of the click, not a reading
              // gesture, so it must not be mistaken for one — otherwise
              // inspecting a word at the bottom of the screen silently stops
              // follow-along, which is the bug this whole change is fixing.
              this.#suppressScrollPause();
              this.#callbacks.onSelectWord(lineIndex, wordIndex);
              this.#callbacks.onSeek(word.startSec);
            },
          },
          ...stack,
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
            'data-tip': 'Play from here',
            onclick: () => {
              this.#suppressScrollPause();
              this.#callbacks.onSeek(line.startSec);
            },
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

  /**
   * Ignore scroll events for a moment, because we just caused one.
   *
   * Used around deliberate interactions — clicking a word, jumping to a
   * timecode — where the browser may scroll as a side effect.
   */
  #suppressScrollPause(durationMs = 500): void {
    this.#guard.mute(performance.now(), durationMs);
  }

  /**
   * Bring a line into view, centred, without tripping the user-scroll guard.
   *
   * Positions are computed against the scroll container rather than handed to
   * `scrollIntoView`, which would also scroll ancestors and can drag the whole
   * page around when the score sits inside another scrolling region.
   */
  #scrollTo(lineIndex: number): void {
    const node = this.#lineNodes[lineIndex];
    const scroller = this.#scroller;
    if (!node || !scroller) return;

    // Rects, not `offsetTop`: the latter is relative to the nearest positioned
    // ancestor, which is not reliably the scroll container.
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta = nodeRect.top - scrollerRect.top - (scroller.clientHeight - nodeRect.height) / 2;
    const target = scroller.scrollTop + delta;
    const top = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
    if (Math.abs(top - scroller.scrollTop) < 2) return;

    // Smooth scrolling emits events for a while after the call returns, so the
    // mute has to outlive the animation or the tail end reads as a hand
    // scroll and switches follow off.
    this.#guard.mute(performance.now(), 700);
    scroller.scrollTo({ top, behavior: 'smooth' });
  }

  /**
   * How far the sung line sits from the middle of the view, in pixels.
   *
   * `null` when there is no sung line, or when it is not laid out — the two
   * cases where "is the song where you are looking?" has no answer, and
   * follow-along must therefore stay where the reader put it.
   */
  #distanceFromCentre(lineIndex: number): number | null {
    const node = this.#lineNodes[lineIndex];
    const scroller = this.#scroller;
    if (!node || !scroller) return null;
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const centre = scrollerRect.top + scrollerRect.height / 2;
    return Math.abs(nodeRect.top + nodeRect.height / 2 - centre);
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
      // Scroll whenever the line changes, not only during playback — jumping
      // to a line while paused should bring it into view too.
      if (this.#follow) this.#scrollTo(lineIndex);
    }

    /*
     * Paused, but the song may have come back to you.
     *
     * Checked on every tick rather than only when the line changes, because
     * the reader is the one moving: they scroll to somewhere ahead, the sung
     * line is still elsewhere, and the moment that stops being true is a
     * moment of theirs, not of the score's.
     */
    if (!this.#follow && lineIndex >= 0) {
      const scroller = this.#scroller;
      const distance = this.#distanceFromCentre(lineIndex);
      if (scroller && this.#guard.resumable(performance.now(), distance, scroller.clientHeight)) {
        this.#callbacks.onFollowResume();
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
