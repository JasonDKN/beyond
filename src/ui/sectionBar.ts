import type { State } from '@/core/store';
import { getSheet, sectionSpans, type SectionSpan } from '@/transcription/providers/lyrics';
import { clear, el, formatClock } from './dom';

/**
 * The song's parts, as buttons under the waveform.
 *
 * Nothing here is invented or arranged by hand. If the lyric sheet you pasted
 * is written the way lyric sheets are written — `[Intro: j-hope]`,
 * `[Pre-Chorus: V, Jung Kook, Jin, Jimin]` — then the parts are already in it,
 * and your taps already say when each one happens. So the strip is just those
 * two facts drawn together: click a part, hear it.
 *
 * Each block is proportional to how long the part lasts, which makes the shape
 * of the song legible at a glance as well as clickable. It lives with the
 * transport rather than inside a view mode, because all three modes need to
 * jump around the song.
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
      .map(
        (span) =>
          `${span.section.id}:${span.section.label}:${span.section.kind}:` +
          `${span.startSec.toFixed(2)}:${span.endSec.toFixed(2)}`,
      )
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
      const { name, artists } = span.section;

      const block = el(
        'button',
        {
          class: `sections__block is-${span.section.kind}`,
          type: 'button',
          style: `left: ${left.toFixed(3)}%; width: calc(${width.toFixed(3)}% - 2px)`,
          'data-tip':
            `${name} — ${formatClock(span.startSec)} to ${formatClock(span.endSec)}` +
            (artists.length > 0 ? `\n${artists.join(', ')}` : '') +
            `\nClick to play from here` +
            `\n\`Shift\`-click to loop this part` +
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
        // The part's name, not the whole heading. "Pre-Chorus" fits in a
        // block; "Pre-Chorus: V, Jung Kook, Jin, Jimin" does not, and the
        // credits are one hover away.
        el('span', { class: 'sections__label' }, name),
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

    // Mark whichever part the loop currently covers.
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
