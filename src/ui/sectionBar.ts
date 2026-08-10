import type { State } from '@/core/store';
import { getSheet, sectionSpans, type SectionSpan } from '@/transcription/providers/lyrics';
import { clear, el, formatClock } from './dom';

/**
 * The song's structure, as a strip under the waveform.
 *
 * Each part of the track gets a block proportional to its length, so the shape
 * of the song — verse, chorus, verse, chorus, bridge — is legible at a glance
 * and any part is one click from playing. That is most of what you want while
 * drilling a passage: not to scrub around hunting for the second hook, but to
 * click "Hook" and have it play.
 *
 * Lives outside the three view modes on purpose. Annotation, Learning and
 * Practice all need to jump around the song, so this belongs to the transport
 * rather than to any one of them.
 */

export interface SectionBarCallbacks {
  onSeek(seconds: number): void;
  onLoop(startSec: number, endSec: number): void;
  onPlay(): void;
}

export class SectionBarView {
  readonly element: HTMLElement;

  #callbacks: SectionBarCallbacks;
  #track: HTMLElement;
  #spans: SectionSpan[] = [];
  #signature = '';
  #activeIndex = -1;

  constructor(callbacks: SectionBarCallbacks) {
    this.#callbacks = callbacks;
    this.#track = el('div', { class: 'sections__track' });
    this.element = el(
      'section',
      { class: 'sections', 'aria-label': 'Song sections' },
      this.#track,
    );
  }

  update(state: State): void {
    const duration = state.audio?.durationSec ?? 0;
    const spans = duration > 0 ? sectionSpans(getSheet(), duration) : [];

    // Rebuild only when the structure actually changes; this runs on every
    // animation frame during playback.
    const signature = spans
      .map((span) => `${span.section.id}:${span.startSec.toFixed(2)}:${span.endSec.toFixed(2)}`)
      .join('|');
    if (signature !== this.#signature) {
      this.#signature = signature;
      this.#spans = spans;
      this.#build(duration);
    }

    this.element.classList.toggle('is-hidden', spans.length === 0);
    this.#highlight(state.currentTime, state.loop);
  }

  #build(durationSec: number): void {
    clear(this.#track);
    if (this.#spans.length === 0) return;

    for (const span of this.#spans) {
      // Placed on the timeline rather than packed end to end, so the strip
      // agrees with the waveform above it: a song whose first line lands ten
      // seconds in should show ten seconds of nothing.
      const left = (span.startSec / durationSec) * 100;
      const width = ((span.endSec - span.startSec) / durationSec) * 100;
      const untimed = span.timedCount < span.lineCount;

      const block = el(
        'button',
        {
          class: `sections__block is-${span.section.kind}`,
          type: 'button',
          style: `left: ${left.toFixed(3)}%; width: calc(${width.toFixed(3)}% - 2px)`,
          title:
            `${span.section.label} — ${formatClock(span.startSec)} to ${formatClock(span.endSec)}\n` +
            `Click to play from here · Shift-click to loop this section` +
            (untimed ? `\n${span.lineCount - span.timedCount} line(s) still untimed` : ''),
          onclick: (event: Event) => {
            // Shift turns a jump into a loop, which is how you drill one part
            // without setting A and B by hand every time.
            if ((event as MouseEvent).shiftKey) {
              this.#callbacks.onLoop(span.startSec, span.endSec);
            }
            this.#callbacks.onSeek(span.startSec);
            this.#callbacks.onPlay();
          },
        },
        el('span', { class: 'sections__label' }, span.section.label),
        span.section.repeatOf ? el('span', { class: 'sections__repeat' }, '↺') : null,
      );

      if (untimed) block.classList.add('is-partial');
      this.#track.appendChild(block);
    }
  }

  #highlight(currentTime: number, loop: State['loop']): void {
    const index = this.#spans.findIndex(
      (span) => currentTime >= span.startSec && currentTime < span.endSec,
    );
    const blocks = [...this.#track.children] as HTMLElement[];

    if (index !== this.#activeIndex) {
      blocks[this.#activeIndex]?.classList.remove('is-current');
      blocks[index]?.classList.add('is-current');
      this.#activeIndex = index;
    }

    // Mark whichever section the loop currently covers.
    blocks.forEach((block, i) => {
      const span = this.#spans[i];
      const looped =
        loop !== null &&
        span !== undefined &&
        Math.abs(loop.start - span.startSec) < 0.05 &&
        Math.abs(loop.end - span.endSec) < 0.05;
      block.classList.toggle('is-looped', looped);
    });
  }
}
