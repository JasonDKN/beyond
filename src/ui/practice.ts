import { audioContext } from '@/audio/decoder';
import { Recorder, RecorderError, type Take } from '@/audio/recorder';
import { takeStartOffset } from '@/practice/sync';
import { computePeaks, detectOnsets } from '@/audio/peaks';
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
  /** Where the song actually is — not where it was asked to be. */
  getPosition(): number;
  /**
   * Duck the backing track to `level`, or pass null to restore whatever the
   * volume was before. Used while a take plays so your own voice sits on top
   * of the mix rather than under it.
   */
  setBackingLevel(level: number | null): void;
}

/** How far the track is turned down while a take plays over it. */
const BACKING_LEVEL = 0.55;

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
  #source: AudioBufferSourceNode | null = null;
  #syncFrame = 0;
  /** True while the song is playing underneath a take. */
  #backing = false;
  /**
   * Manual sync trim, in seconds. Positive pushes your voice later.
   *
   * The measured latency is an estimate from onset detection, and audio
   * hardware varies more than any estimate can allow for. Rather than insist
   * the number is right, this lets you settle it by ear in a few seconds.
   */
  #trimSec = 0;
  /**
   * Play takes over the song rather than dry.
   *
   * On by default, because judging yourself against the backing is the point.
   * Off is still worth having: dry is how you check a consonant you cannot
   * pick out of the mix.
   */
  #withTrack = true;

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

    const take = this.#recorder.stop();
    if (!take) {
      this.#hint.textContent =
        'No audio reached the microphone. Check the right input device is selected, then try again.';
      this.#hint.classList.add('is-error');
      return;
    }
    this.#hint.classList.remove('is-error');

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
    // Samples come straight from the microphone tap — already mono, no decode
    // step, so nothing between the mic and the analysis can misinterpret them.
    const envelope = computePeaks(take.samples, TAKE_BUCKETS);
    const onsets = detectOnsets(envelope, take.sampleRate).map(
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
    if (!current) {
      // Nothing selected — either no takes yet, or the last one was deleted.
      this.#scoreValue.textContent = '—';
      this.#scoreValue.className = 'practice__score-value';
      this.#scoreDetail.textContent = '';
      clear(this.#heatmap);
      this.#renderTakes();
      return;
    }

    // A take recorded past the end of your timed lines has nothing to be
    // graded against. Scoring that zero would be a lie — there was no target
    // to miss — so say what actually happened.
    if (current.expected.length === 0) {
      this.#scoreValue.textContent = '—';
      this.#scoreValue.className = 'practice__score-value';
      this.#scoreDetail.textContent =
        'No timed lines in this stretch of the track, so there was nothing to score against. Set a loop over a passage you have tapped.';
      clear(this.#heatmap);
      this.#renderTakes();
      return;
    }

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
            'data-tip':
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

      // Select and delete are separate buttons in a wrapper rather than one
      // button with an icon inside it — nesting interactive elements is
      // invalid, and it makes the delete target ambiguous to a screen reader.
      const select = el(
        'button',
        {
          class: 'practice__take-select',
          type: 'button',
          'data-tip': `From ${formatClock(entry.take.startedAtSec)} · ${entry.take.durationSec.toFixed(1)}s — click to hear it back`,
          onclick: () => {
            this.#current = entry;
            this.#render();
            this.#playTake(entry);
          },
        },
        el(
          'span',
          { class: `practice__take-score ${bandFor(entry.score.overall)}` },
          String(entry.score.overall),
        ),
        el(
          'span',
          { class: 'practice__take-when' },
          index === 0 ? 'latest' : `#${this.#takes.length - index}`,
        ),
      );

      // No confirmation step. A take is a few seconds of audio you can redo in
      // a few seconds — quite unlike deleting a track, which loses an evening
      // of tapping and does ask twice.
      const remove = el(
        'button',
        {
          class: 'practice__take-delete',
          type: 'button',
          'aria-label': `Delete take ${this.#takes.length - index}`,
          'data-tip': 'Delete this take',
          onclick: () => this.#deleteTake(entry),
        },
        '✕',
      );

      this.#takeList.appendChild(
        el('div', { class: `practice__take${isCurrent ? ' is-current' : ''}` }, select, remove),
      );
    });

    // Sync trim. The measured latency is an estimate; this is the escape hatch
    // for when your hardware disagrees with it.
    const trim = el('input', {
      type: 'range',
      class: 'practice__trim',
      min: '-250',
      max: '250',
      step: '10',
      value: String(Math.round(this.#trimSec * 1000)),
      'aria-label': 'Nudge your voice earlier or later against the track',
      oninput: (event: Event) => {
        this.#trimSec = Number((event.target as HTMLInputElement).value) / 1000;
        const label = this.#takeList.querySelector('.practice__trim-value');
        if (label) label.textContent = formatTrim(this.#trimSec);
      },
    });

    const withTrack = el('input', {
      type: 'checkbox',
      class: 'control__checkbox control__checkbox--small',
      checked: this.#withTrack,
      onchange: (event: Event) => {
        this.#withTrack = (event.target as HTMLInputElement).checked;
        this.#stopPlayback();
      },
    });

    this.#takeList.appendChild(
      el(
        'label',
        {
          class: 'practice__withtrack',
          'data-tip': 'Play takes over the song, starting from where you hit record',
        },
        withTrack,
        el('span', {}, 'With track'),
      ),
    );

    this.#takeList.appendChild(
      el(
        'label',
        { class: 'practice__trim-group', title: 'Nudge your voice against the track, by ear' },
        el('span', { class: 'practice__trim-label' }, 'Sync'),
        trim,
        el('span', { class: 'practice__trim-value' }, formatTrim(this.#trimSec)),
      ),
    );

    this.#takeList.appendChild(
      el(
        'button',
        {
          class: 'practice__clear',
          type: 'button',
          'data-tip': 'Delete every take',
          onclick: () => this.#clearTakes(),
        },
        'Clear all',
      ),
    );
  }

  #deleteTake(entry: StoredTake): void {
    const index = this.#takes.indexOf(entry);
    if (index < 0) return;

    // If it is playing, stop it — otherwise a deleted take keeps talking.
    if (this.#current === entry) this.#stopPlayback();

    this.#takes.splice(index, 1);

    if (this.#current === entry) {
      // Fall to the take that took its place in the list, or the one before
      // it if we removed the last, so the panel never lands on nothing while
      // takes remain.
      this.#current = this.#takes[index] ?? this.#takes[index - 1] ?? null;
    }

    this.#render();
  }

  #clearTakes(): void {
    this.#stopPlayback();
    this.#takes = [];
    this.#current = null;
    this.#render();
  }

  /**
   * Play a take back over the song, from where recording began.
   *
   * Hearing yourself dry tells you very little; hearing yourself against the
   * backing is the actual test. The track is turned down while it plays so
   * your voice sits on top, and restored afterwards.
   *
   * The take is advanced by the latency the scorer measured. That correction
   * matters: without it your voice arrives a constant 100-odd milliseconds
   * late no matter how well you performed, because that lag is your audio
   * hardware, not your timing. Playing it raw would have your ears contradict
   * the score — and the ears would be wrong.
   */
  #playTake(entry: StoredTake): void {
    this.#stopPlayback();

    if (!this.#withTrack) {
      this.#callbacks.onPause();
      this.#startSource(entry, 0);
      return;
    }

    const recordedAt = entry.take.startedAtSec;
    this.#callbacks.onSeek(recordedAt);
    this.#callbacks.setBackingLevel(BACKING_LEVEL);
    this.#callbacks.onPlay();
    this.#backing = true;

    // Wait until the song is genuinely rolling before starting the take.
    //
    // An <audio> element does not begin the instant play() is called — it
    // resumes, buffers, and starts some tens of milliseconds later. Starting
    // the take at the same moment as the *call* therefore put the voice ahead
    // of a song that had not started yet, which then read as the voice being
    // late once the song caught up. Aligning to where the song actually is
    // removes that guesswork entirely.
    const deadline = performance.now() + 2000;
    const waitForRoll = (): void => {
      const position = this.#callbacks.getPosition();
      if (position > recordedAt + 0.001) {
        this.#startSource(
          entry,
          takeStartOffset({
            trackPositionSec: position,
            recordedAtSec: recordedAt,
            latencySec: Math.max(0, entry.score.offsetSec),
            trimSec: this.#trimSec,
            takeDurationSec: entry.take.durationSec,
          }),
        );
        return;
      }
      // Autoplay refused, or the file will not roll. Play the take dry rather
      // than spinning forever on a song that is never going to start.
      if (performance.now() > deadline) {
        this.#startSource(entry, 0);
        return;
      }
      this.#syncFrame = requestAnimationFrame(waitForRoll);
    };
    this.#syncFrame = requestAnimationFrame(waitForRoll);
  }

  /**
   * Play the take through Web Audio rather than an audio element.
   *
   * The samples are already in memory, so a buffer source starts immediately
   * and seeks with sample accuracy — no blob fetch, no header parse, no
   * `loadedmetadata` race deciding whether the offset got applied at all.
   */
  #startSource(entry: StoredTake, fromSec: number): void {
    const context = audioContext();
    const buffer = context.createBuffer(
      1,
      entry.take.samples.length,
      entry.take.sampleRate,
    );
    // `set` rather than copyToChannel: the samples arrive typed against a
    // generic ArrayBufferLike (they may have come from a worklet), which
    // copyToChannel's signature refuses.
    buffer.getChannelData(0).set(entry.take.samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => this.#stopPlayback();
    source.start(0, Math.max(0, Math.min(fromSec, Math.max(0, buffer.duration - 0.01))));
    this.#source = source;
  }

  #stopPlayback(): void {
    if (this.#syncFrame) {
      cancelAnimationFrame(this.#syncFrame);
      this.#syncFrame = 0;
    }
    if (this.#backing) {
      this.#callbacks.onPause();
      this.#callbacks.setBackingLevel(null);
      this.#backing = false;
    }
    if (this.#source) {
      this.#source.onended = null;
      try {
        this.#source.stop();
      } catch {
        // Already finished; stopping twice throws and means nothing.
      }
      this.#source.disconnect();
      this.#source = null;
    }
  }
}

function formatTrim(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  if (ms === 0) return 'auto';
  return `${ms > 0 ? '+' : ''}${ms} ms`;
}

function bandFor(score: number): string {
  if (score >= 85) return 'is-strong';
  if (score >= 65) return 'is-fair';
  return 'is-weak';
}
