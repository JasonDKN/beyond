import type { State } from '@/core/store';
import {
  getSheet,
  sectionSpans,
  type LyricSection,
  type SectionSpan,
} from '@/transcription/providers/lyrics';
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

/** Just the bit of a span that decides where it can sit. */
export interface LaneSpan {
  readonly startSec: number;
  readonly endSec: number;
}

/**
 * Which row each part is drawn on, so overlapping ones stack instead of
 * covering each other.
 *
 * One row was an assumption that parts never overlap, and they do — a chorus
 * whose tail runs under the next verse, a rap over a hook, two artists' passes
 * at the same bars. When they did, the labels smeared together and neither
 * could be read or clicked.
 *
 * Greedy assignment, which is optimal here because the spans arrive in start
 * order: put each span in the first lane whose previous span has finished, and
 * open a new lane only when none has. That is interval partitioning, and it
 * uses exactly as many lanes as the busiest instant needs.
 *
 * Returns one lane index per span, in the order given.
 */
export function assignLanes(spans: readonly LaneSpan[]): number[] {
  const laneEnds: number[] = [];

  return spans.map((span) => {
    // A hair of tolerance, so a part ending exactly where the next begins is
    // adjacent rather than overlapping.
    const found = laneEnds.findIndex((end) => span.startSec >= end - 0.001);
    if (found >= 0) {
      laneEnds[found] = span.endSec;
      return found;
    }
    laneEnds.push(span.endSec);
    return laneEnds.length - 1;
  });
}

/**
 * Everyone who takes a line in this part, in the order they first appear.
 *
 * Reported in the tooltip so the label does not have to carry it. Writing
 * "Chorus: Jung Kook, Jimin" by hand works, but it makes for a label too long
 * to read in a narrow block — and it goes stale the moment a line is retagged.
 */
function singersIn(section: LyricSection): string {
  const sheet = getSheet();
  const names = new Map((sheet.artists ?? []).map((artist) => [artist.id, artist.name]));
  const seen = new Set<string>();

  for (const line of sheet.lines) {
    if (line.sectionId !== section.id) continue;
    const id = line.artistId ?? section.artistId;
    if (id === undefined) continue;
    const name = names.get(id);
    if (name) seen.add(name);
  }
  // A section credited as a whole, with no lines placed in it yet.
  if (seen.size === 0 && section.artistId !== undefined) {
    const name = names.get(section.artistId);
    if (name) seen.add(name);
  }
  return [...seen].join(', ');
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
    // Cheap on purpose: this runs on every animation frame during playback, so
    // the credits are folded in as one flat pass over the sheet rather than
    // one pass per section.
    const sheet = getSheet();
    const credits =
      (sheet.artists ?? []).map((artist) => artist.id + artist.name).join(',') +
      '|' +
      sheet.lines.map((line) => line.artistId ?? '').join(',');

    const signature =
      spans
        .map(
          (span) =>
            `${span.section.id}:${span.section.label}:${span.section.kind}:` +
            `${span.section.artistId ?? ''}:` +
            `${span.startSec.toFixed(2)}:${span.endSec.toFixed(2)}`,
        )
        .join('|') + credits;
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

    const lanes = assignLanes(this.#spans);
    const laneCount = Math.max(1, ...lanes.map((lane) => lane + 1));

    for (const [index, span] of this.#spans.entries()) {
      const lane = lanes[index] ?? 0;
      // Placed on the timeline rather than packed end to end, so the strip
      // agrees with the waveform above it: a song whose first line lands ten
      // seconds in should show ten seconds of nothing.
      const left = (span.startSec / durationSec) * 100;
      const width = ((span.endSec - span.startSec) / durationSec) * 100;
      const untimed = span.timedCount < span.lineCount;
      const singers = singersIn(span.section);

      const block = el(
        'button',
        {
          class: `sections__block is-${span.section.kind}`,
          type: 'button',
          style:
            `left: ${left.toFixed(3)}%; width: calc(${width.toFixed(3)}% - 2px); ` +
            `top: calc(${lane} * (var(--lane-height) + var(--lane-gap)))`,
          title:
            `${span.section.label} — ${formatClock(span.startSec)} to ${formatClock(span.endSec)}` +
            (singers === '' ? '' : `\nSung by ${singers}`) +
            (span.occurrenceIndex > 0
              ? `\nRepeat ${span.occurrenceIndex + 1} of ${span.section.occurrences.length}`
              : span.section.occurrences.length > 1
                ? `\nPlays ${span.section.occurrences.length}× — this is the one you tapped`
                : '') +
            `\nClick to play from here · Shift-click to loop this section` +
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
        span.occurrenceIndex > 0 ? el('span', { class: 'sections__repeat' }, '↺') : null,
      );

      if (untimed) block.classList.add('is-partial');
      this.#track.appendChild(block);
    }

    // The strip grows to fit however many lanes it took.
    this.#track.style.setProperty('--lanes', String(laneCount));
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
