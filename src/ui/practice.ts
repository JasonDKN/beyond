import { Recorder, RecorderError, type Take } from '@/audio/recorder';
import { computePeaks, detectOnsets, mixdown } from '@/audio/peaks';
import type { State, Store } from '@/core/store';
import { expectedSyllables, type ExpectedSyllable } from '@/practice/expected';
import { describeScore, scoreTiming, type TimingScore } from '@/practice/score';
import { clear, el, formatClock } from './dom';

/**
 * Practice mode.
 *
 * Record yourself over the track, and see where your syllables landed against
 * the grid you tapped. Nothing here grades pronunciation — that comes later,
 * and it needs a model and a lot more care. This grades rhythm, which for rap
 * is most of the battle and, crucially, is something you can verify by ear.
 *
 * Headphones are not optional. A microphone recording you rapping over
 * speakers captures the backing track too, and every drum hit reads as a
 * syllable.
 */

export interface PracticeCallbacks {
  onSeek(seconds: number): void;
  onPlay(): void;
  onPause(): void;
}

interface StoredTake {
  readonly take: Take;
  readonly score: TimingScore;
  readonly expected: readonly ExpectedSyllable[];
}

/** Envelope resolution for onset detection on a take. */
const TAKE_BUCKETS = 2000;

export class PracticeView {
  readonly element: HTMLElement;

  #store: Store;
  #callbacks: PracticeCallbacks;
  #recorder = new Recorder();

  #recordButton: HTMLButtonElement;
  #hint: HTMLElement;
  #scoreValue: HTMLElement;
  #scoreDetail: HTMLElement;
  #heatmap: HTMLElement;
  #takeList: HTMLElement;

  #takes: StoredTake[] = [];
  #current: StoredTake | null = null;
  #playback: HTMLAudioElement | null = null;

  constructor(store: Store, callbacks: PracticeCallbacks) {
    this.#store = store;
    this.#callbacks = callbacks;

    this.#recordButton = el(
      'button',
      {
        class: 'practice__record',
        type: 'button',
        onclick: () => void this.#toggleRecording(),
      },
      'Record a take',
    ) as HTMLButtonElement;

    this.#hint = el(
      'p',
      { class: 'practice__hint' },
      'Wear headphones — a microphone hearing the backing track will score the drums as syllables.',
    );

    this.#scoreValue = el('span', { class: 'practice__score-value' }, '—');
    this.#scoreDetail = el('p', { class: 'practice__score-detail' });
    this.#heatmap = el('div', { class: 'practice__heatmap' });
    this.#takeList = el('div', { class: 'practice__takes' });

    this.element = el(
      'section',
      { class: 'practice' },
      el(
        'header',
        { class: 'practice__head' },
        this.#recordButton,
        el(
          'div',
          { class: 'practice__score' },
          this.#scoreValue,
          el('span', { class: 'practice__score-label' }, 'timing'),
        ),
        this.#scoreDetail,
      ),
      this.#hint,
      this.#heatmap,
      this.#takeList,
    );
  }

  update(state: State): void {
    const usable = state.mode === 'practice' && state.score !== null;
    this.element.classList.toggle('is-hidden', state.mode !== 'practice');
    this.#recordButton.disabled = !usable || !Recorder.supported();

    if (state.mode !== 'practice') return;

    if (!Recorder.supported()) {
      this.#hint.textContent = 'This browser cannot record audio.';
    } else if (!state.score) {
      this.#hint.textContent = 'Build the score first — Practice grades against your tapped grid.';
    }
  }

  /** Called when leaving the mode, so the browser drops its recording indicator. */
  release(): void {
    this.#recorder.release();
    this.#stopPlayback();
  }

  // -------------------------------------------------------------------------

  async #toggleRecording(): Promise<void> {
    if (this.#recorder.isRecording) {
      await this.#finish();
      return;
    }
    await this.#begin();
  }

  async #begin(): Promise<void> {
    try {
      await this.#recorder.arm();
    } catch (error) {
      this.#hint.textContent =
        error instanceof RecorderError ? error.message : 'Could not open the microphone.';
      this.#hint.classList.add('is-error');
      return;
    }
    this.#hint.classList.remove('is-error');

    const state = this.#store.state;
    // Take it from the top of the loop if one is set — the loop is how you
    // pick a passage to drill, so it is also the natural unit to be graded on.
    const from = state.loop ? state.loop.start : state.currentTime;
    this.#callbacks.onSeek(from);
    this.#stopPlayback();

    this.#recorder.start(from);
    this.#callbacks.onPlay();

    this.#recordButton.textContent = 'Stop';
    this.#recordButton.classList.add('is-recording');
    this.#hint.textContent = 'Recording… rap along, then press Stop.';
  }

  async #finish(): Promise<void> {
    this.#recordButton.textContent = 'Record a take';
    this.#recordButton.classList.remove('is-recording');
    this.#callbacks.onPause();

    let take: Take | null = null;
    try {
      take = await this.#recorder.stop();
    } catch (error) {
      this.#hint.textContent =
        error instanceof RecorderError ? error.message : 'The recording failed.';
      this.#hint.classList.add('is-error');
      return;
    }
    if (!take) {
      this.#hint.textContent = 'Nothing was recorded.';
      return;
    }

    const scored = this.#analyse(take);
    this.#takes.unshift(scored);
    // Takes hold decoded audio, so a long session would otherwise sit on a lot
    // of memory. Six is plenty to compare against.
    this.#takes = this.#takes.slice(0, 6);
    this.#current = scored;

    this.#hint.textContent = 'Click any syllable to hear that moment in the original.';
    this.#render();
  }

  /**
   * Turn a take into a score.
   *
   * Onsets are detected on the recording's own timeline, then shifted by where
   * recording began so they can be compared against the track's grid.
   */
  #analyse(take: Take): StoredTake {
    const envelope = computePeaks(mixdown(take.buffer), TAKE_BUCKETS);
    const onsets = detectOnsets(envelope, take.buffer.sampleRate).map(
      (time) => time + take.startedAtSec,
    );

    const expected = expectedSyllables(
      this.#store.state.score,
      take.startedAtSec,
      take.startedAtSec + take.durationSec,
    );

    return {
      take,
      expected,
      score: scoreTiming(
        expected.map((syllable) => syllable.startSec),
        onsets,
      ),
    };
  }

  #render(): void {
    const current = this.#current;
    if (!current) return;

    this.#scoreValue.textContent = String(current.score.overall);
    this.#scoreValue.className = `practice__score-value ${bandFor(current.score.overall)}`;
    this.#scoreDetail.textContent = describeScore(current.score);

    // The heatmap: one cell per expected syllable, coloured by how close you
    // landed. Reading along it tells you *where* in the bar you slipped, which
    // the single number never can.
    clear(this.#heatmap);
    current.score.syllables.forEach((timing, index) => {
      const syllable = current.expected[index];
      if (!syllable) return;
      const delta = timing.deltaSec;
      this.#heatmap.appendChild(
        el(
          'button',
          {
            class: `practice__cell is-${timing.rating}${syllable.wordStart ? ' is-word-start' : ''}`,
            type: 'button',
            title:
              delta === null
                ? `${syllable.glyph} — not heard`
                : `${syllable.glyph} — ${delta > 0 ? '+' : ''}${Math.round(delta * 1000)} ms`,
            onclick: () => this.#callbacks.onSeek(syllable.startSec),
          },
          el('span', { class: 'practice__cell-glyph' }, syllable.glyph),
          el(
            'span',
            { class: 'practice__cell-delta' },
            delta === null ? '–' : `${delta > 0 ? '+' : ''}${Math.round(delta * 1000)}`,
          ),
        ),
      );
    });

    this.#renderTakes();
  }

  #renderTakes(): void {
    clear(this.#takeList);
    if (this.#takes.length === 0) return;

    this.#takeList.appendChild(el('span', { class: 'practice__takes-label' }, 'Takes'));

    this.#takes.forEach((entry, index) => {
      const isCurrent = entry === this.#current;
      this.#takeList.appendChild(
        el(
          'button',
          {
            class: `practice__take${isCurrent ? ' is-current' : ''}`,
            type: 'button',
            title: `From ${formatClock(entry.take.startedAtSec)} · ${entry.take.durationSec.toFixed(1)}s`,
            onclick: () => {
              this.#current = entry;
              this.#render();
              this.#playTake(entry);
            },
          },
          el('span', { class: `practice__take-score ${bandFor(entry.score.overall)}` },
            String(entry.score.overall)),
          el('span', { class: 'practice__take-when' }, index === 0 ? 'latest' : `#${this.#takes.length - index}`),
        ),
      );
    });
  }

  /** Play a take back on its own, so you can hear what the score is describing. */
  #playTake(entry: StoredTake): void {
    this.#stopPlayback();
    this.#callbacks.onPause();
    const audio = new Audio(URL.createObjectURL(entry.take.blob));
    this.#playback = audio;
    audio.addEventListener('ended', () => this.#stopPlayback(), { once: true });
    void audio.play().catch(() => undefined);
  }

  #stopPlayback(): void {
    if (!this.#playback) return;
    this.#playback.pause();
    URL.revokeObjectURL(this.#playback.src);
    this.#playback = null;
  }
}

function bandFor(score: number): string {
  if (score >= 85) return 'is-strong';
  if (score >= 65) return 'is-fair';
  return 'is-weak';
}
