/**
 * Timing scoring.
 *
 * You already told the app where every syllable lands when you tapped the
 * track. Practice mode compares that grid against where the syllables landed
 * when *you* said them, and the difference is a rhythm score.
 *
 * The whole thing turns on one correction. There is always a constant lag
 * between the music you hear in your headphones and the moment your voice
 * reaches the microphone — output buffering, mic buffering, and the speed of
 * sound through your own skull. It is easily 50–150 ms and it varies by
 * machine. Without removing it, every syllable reads as late and the score is
 * a measurement of your hardware rather than your rapping.
 *
 * So the offset is estimated first, subtracted, and only then is anything
 * graded. What survives is what you actually control: whether you are early or
 * late *relative to yourself*.
 */

export interface SyllableTiming {
  /** Index into the line's syllables, for lining the heatmap back up. */
  readonly index: number;
  readonly expectedSec: number;
  /** Where it actually landed, offset-corrected. Null when nothing was heard. */
  readonly actualSec: number | null;
  /** Signed error in seconds; positive is late. Null when missed. */
  readonly deltaSec: number | null;
  readonly rating: Rating;
}

export type Rating = 'tight' | 'close' | 'loose' | 'missed';

export interface TimingScore {
  /** 0–100. */
  readonly overall: number;
  /** The constant lag that was removed before grading, in seconds. */
  readonly offsetSec: number;
  readonly syllables: readonly SyllableTiming[];
  /** Onsets heard that no expected syllable claimed — stumbles, breaths, noise. */
  readonly extras: number;
  readonly missed: number;
  /** Mean absolute error after offset removal, in seconds. */
  readonly meanErrorSec: number;
  /**
   * Positive when you are consistently behind the beat even after the constant
   * lag is removed — which is a real habit, not a hardware artefact.
   */
  readonly driftSec: number;
}

/** Grading thresholds, in seconds. */
const TIGHT = 0.06;
const CLOSE = 0.12;
const LOOSE = 0.22;
/** Beyond this, no detected onset is considered to belong to the syllable. */
const MATCH_WINDOW = 0.3;

/** How far the search for the constant lag reaches, and how finely. */
const OFFSET_RANGE = 0.6;
const OFFSET_STEP = 0.005;

/**
 * Find the constant lag between the expected grid and what was heard.
 *
 * A plain grid search: for each candidate offset, sum how far every expected
 * onset sits from the nearest detected one, and keep the best. Crude, but the
 * search space is one dimension and 240 candidates costs nothing — and unlike
 * cross-correlation it degrades gracefully when half the syllables are missing.
 */
export function estimateOffset(
  expected: readonly number[],
  detected: readonly number[],
): number {
  if (expected.length === 0 || detected.length === 0) return 0;

  let bestOffset = 0;
  let bestCost = Infinity;

  for (let offset = -OFFSET_RANGE; offset <= OFFSET_RANGE; offset += OFFSET_STEP) {
    let cost = 0;
    for (const time of expected) {
      const target = time + offset;
      let nearest = Infinity;
      for (const hit of detected) {
        const distance = Math.abs(hit - target);
        if (distance < nearest) nearest = distance;
        // `detected` is sorted, so once we are past the target and moving
        // away, no later onset can be closer.
        if (hit > target && distance > nearest) break;
      }
      // Cap each term so one wildly missing syllable cannot dominate the fit.
      cost += Math.min(nearest, MATCH_WINDOW);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }

  return Number(bestOffset.toFixed(3));
}

function rate(absError: number): Rating {
  if (absError <= TIGHT) return 'tight';
  if (absError <= CLOSE) return 'close';
  if (absError <= LOOSE) return 'loose';
  return 'missed';
}

/**
 * Score a take against the expected syllable onsets.
 *
 * Both arrays are in seconds on the track's own timeline. `detected` should be
 * sorted ascending; it comes from onset detection over the recording.
 */
export function scoreTiming(
  expected: readonly number[],
  detected: readonly number[],
): TimingScore {
  if (expected.length === 0) {
    return {
      overall: 0,
      offsetSec: 0,
      syllables: [],
      extras: detected.length,
      missed: 0,
      meanErrorSec: 0,
      driftSec: 0,
    };
  }

  const offset = estimateOffset(expected, detected);
  // Bring the recording onto the track's timeline so every number below is
  // expressed in the same terms as the syllable grid.
  const corrected = detected.map((time) => time - offset);

  const claimed = new Set<number>();
  const syllables: SyllableTiming[] = expected.map((expectedSec, index) => {
    let bestIndex = -1;
    let bestDistance = MATCH_WINDOW;

    corrected.forEach((time, candidate) => {
      if (claimed.has(candidate)) return;
      const distance = Math.abs(time - expectedSec);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = candidate;
      }
    });

    if (bestIndex < 0) {
      return { index, expectedSec, actualSec: null, deltaSec: null, rating: 'missed' as const };
    }

    // One detected onset can only satisfy one syllable, or a single loud
    // consonant would score for the three syllables around it.
    claimed.add(bestIndex);
    const actualSec = corrected[bestIndex]!;
    const deltaSec = actualSec - expectedSec;
    return { index, expectedSec, actualSec, deltaSec, rating: rate(Math.abs(deltaSec)) };
  });

  const hits = syllables.filter((s) => s.deltaSec !== null);
  const missed = syllables.length - hits.length;
  const extras = Math.max(0, corrected.length - claimed.size);

  const meanError =
    hits.length === 0
      ? 0
      : hits.reduce((sum, s) => sum + Math.abs(s.deltaSec!), 0) / hits.length;
  const drift =
    hits.length === 0 ? 0 : hits.reduce((sum, s) => sum + s.deltaSec!, 0) / hits.length;

  return {
    overall: overallScore(syllables, extras),
    offsetSec: offset,
    syllables,
    extras,
    missed,
    meanErrorSec: Number(meanError.toFixed(3)),
    driftSec: Number(drift.toFixed(3)),
  };
}

/**
 * Turn the per-syllable ratings into one number.
 *
 * Weighted rather than averaged: landing a syllable within 60 ms is a
 * different achievement from scraping in at 200 ms, and a missed syllable is
 * worse than a late one. Extra onsets cost a little — some are stumbles, but
 * plenty are breaths, so the penalty is deliberately gentle.
 */
function overallScore(syllables: readonly SyllableTiming[], extras: number): number {
  if (syllables.length === 0) return 0;

  const weights: Record<Rating, number> = { tight: 1, close: 0.8, loose: 0.45, missed: 0 };
  const earned = syllables.reduce((sum, s) => sum + weights[s.rating], 0);
  const base = (earned / syllables.length) * 100;
  const penalty = Math.min(10, extras * 1.5);

  return Math.max(0, Math.round(base - penalty));
}

/** A short, plain-language read on the take. */
export function describeScore(score: TimingScore): string {
  if (score.syllables.length === 0) return 'Nothing to score yet.';
  if (score.missed === score.syllables.length) {
    return 'No syllables matched — check the microphone is picking you up.';
  }

  const drift = score.driftSec;
  const timing =
    Math.abs(drift) < 0.03
      ? 'sitting right on the grid'
      : drift > 0
        ? `running about ${Math.round(drift * 1000)} ms behind`
        : `pushing about ${Math.round(-drift * 1000)} ms ahead`;

  const missed = score.missed > 0 ? `, ${score.missed} missed` : '';
  return `On average you're ${timing}${missed}.`;
}
