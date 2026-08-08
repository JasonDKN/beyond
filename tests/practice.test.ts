import { describe, expect, it } from 'vitest';
import { describeScore, estimateOffset, scoreTiming } from '@/practice/score';

/**
 * The scoring is only meaningful if the constant hardware lag is removed
 * first, so most of these tests are really about that: the same performance,
 * recorded through a slower audio path, must score the same.
 */

const grid = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

/** A take that reproduces the grid exactly, delayed by a constant lag. */
const delayed = (times: readonly number[], lag: number): number[] =>
  times.map((t) => t + lag);

describe('latency estimation', () => {
  it('finds a constant lag', () => {
    expect(estimateOffset(grid, delayed(grid, 0.12))).toBeCloseTo(0.12, 2);
    expect(estimateOffset(grid, delayed(grid, -0.08))).toBeCloseTo(-0.08, 2);
  });

  it('finds the lag even when some syllables were missed', () => {
    const partial = delayed(grid, 0.1).filter((_, i) => i % 3 !== 0);
    expect(estimateOffset(grid, partial)).toBeCloseTo(0.1, 1);
  });

  it('survives a stray onset that belongs to nothing', () => {
    const take = [...delayed(grid, 0.09), 2.31];
    expect(estimateOffset(grid, take)).toBeCloseTo(0.09, 1);
  });

  it('returns zero when there is nothing to compare', () => {
    expect(estimateOffset([], [1, 2])).toBe(0);
    expect(estimateOffset(grid, [])).toBe(0);
  });
});

describe('timing score', () => {
  it('gives a perfect take full marks despite a large constant lag', () => {
    // The point of the whole exercise: 150 ms of hardware latency must not
    // read as 150 ms of bad rapping.
    const score = scoreTiming(grid, delayed(grid, 0.15));
    expect(score.overall).toBe(100);
    expect(score.offsetSec).toBeCloseTo(0.15, 2);
    expect(score.syllables.every((s) => s.rating === 'tight')).toBe(true);
    expect(Math.abs(score.driftSec)).toBeLessThan(0.01);
  });

  it('scores a sloppy take below a tight one', () => {
    const tight = scoreTiming(grid, delayed(grid, 0.1));
    const sloppy = scoreTiming(
      grid,
      grid.map((t, i) => t + 0.1 + (i % 2 === 0 ? 0.16 : -0.16)),
    );
    expect(sloppy.overall).toBeLessThan(tight.overall);
    expect(sloppy.overall).toBeGreaterThan(0);
  });

  it('reports syllables it never heard', () => {
    const take = delayed(grid, 0.1).slice(0, 5);
    const score = scoreTiming(grid, take);
    expect(score.missed).toBe(3);
    expect(score.syllables.filter((s) => s.rating === 'missed')).toHaveLength(3);
    expect(score.overall).toBeLessThan(70);
  });

  it('never lets one onset satisfy two syllables', () => {
    // A single sound where two were expected must leave one unmatched,
    // otherwise mumbling through a bar would score as hitting every syllable.
    const score = scoreTiming([1.0, 1.05], [1.02]);
    const matched = score.syllables.filter((s) => s.actualSec !== null);
    expect(matched).toHaveLength(1);
    expect(score.missed).toBe(1);
  });

  it('counts extra onsets and penalises them gently', () => {
    const clean = scoreTiming(grid, delayed(grid, 0.1));
    const noisy = scoreTiming(grid, [...delayed(grid, 0.1), 0.8, 1.8, 2.8]);
    expect(noisy.extras).toBe(3);
    expect(noisy.overall).toBeLessThan(clean.overall);
    // Gentle: breaths should not wipe out a good take.
    expect(clean.overall - noisy.overall).toBeLessThanOrEqual(10);
  });

  it('separates a genuine drag from hardware lag', () => {
    // Progressively later within the take: the constant part is removed, but
    // the growing part is a real habit and must survive.
    const dragging = grid.map((t, i) => t + 0.1 + i * 0.02);
    const score = scoreTiming(grid, dragging);
    expect(score.offsetSec).toBeGreaterThan(0.1);
    expect(score.meanErrorSec).toBeGreaterThan(0.02);
  });

  it('handles an empty grid and a silent take', () => {
    expect(scoreTiming([], [1, 2]).overall).toBe(0);
    const silent = scoreTiming(grid, []);
    expect(silent.missed).toBe(grid.length);
    expect(silent.overall).toBe(0);
  });
});

describe('plain-language summary', () => {
  it('says which side of the beat you are on', () => {
    const late = scoreTiming(grid, grid.map((t, i) => t + 0.1 + (i < 4 ? 0.09 : 0.11)));
    expect(describeScore(late)).toMatch(/behind|ahead|right on the grid/);
  });

  it('calls out a silent recording rather than scoring it zero silently', () => {
    expect(describeScore(scoreTiming(grid, []))).toContain('microphone');
  });
});
