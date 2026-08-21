import { describe, expect, it } from 'vitest';
import { sungEnd, syllableRate, unitCount, wordTimings } from '@/transcription/timing';

/**
 * Where the words of a line fall.
 *
 * Every string here is invented — nonsense syllables and placeholder words.
 * Beyond ships no lyrics and fetches none, and its tests are no exception.
 */

describe('counting what takes time to sing', () => {
  it('gives each hangul block one unit', () => {
    expect(unitCount('가나')).toBe(2);
    expect(unitCount('가나다라마')).toBe(5);
  });

  it('counts vowel groups in an alphabetic word, not letters', () => {
    // The whole reason for this: eight letters, one syllable. Weighing by
    // letters gave this word eight times the time of a hangul block beside it.
    expect(unitCount('thoughts')).toBe(1);
    expect(unitCount('banana')).toBe(3);
  });

  it('does not count a silent final e', () => {
    expect(unitCount('while')).toBe(1);
  });

  it('does count a syllabic l, which the silent-e rule would eat', () => {
    expect(unitCount('table')).toBe(2);
    expect(unitCount('little')).toBe(2);
  });

  it('never gives a word less than one unit', () => {
    expect(unitCount('rhythm')).toBe(1);
    expect(unitCount('!!!')).toBe(0);
  });

  it('handles a line that mixes scripts, which is the normal case here', () => {
    // 가나 is two blocks, "banana" three vowel groups, 다 one block.
    expect(unitCount('가나 banana 다')).toBe(2 + 3 + 1);
  });
});

describe('the rate a song is sung at', () => {
  it('follows the crowded lines, not the ones trailed by silence', () => {
    // Four lines at a fifth of a second per syllable, and one left hanging
    // over a long instrumental. The hanging one must not drag the estimate.
    const samples = [
      { units: 10, availableSec: 2 },
      { units: 8, availableSec: 1.6 },
      { units: 12, availableSec: 2.4 },
      { units: 6, availableSec: 1.2 },
      { units: 4, availableSec: 20 },
    ];
    expect(syllableRate(samples)).toBeCloseTo(0.2, 2);
  });

  it('falls back to something sane when there is nothing to measure', () => {
    expect(syllableRate([])).toBeGreaterThan(0.1);
    expect(syllableRate([])).toBeLessThan(0.4);
  });

  it('refuses rates no human could produce', () => {
    expect(syllableRate([{ units: 400, availableSec: 1 }])).toBeGreaterThanOrEqual(0.08);
    expect(syllableRate([{ units: 1, availableSec: 90 }])).toBeLessThanOrEqual(0.55);
  });
});

describe('where a line stops being sung', () => {
  it('stops early when a long silence follows, instead of filling it', () => {
    // Six syllables at 0.2s is a bit over a second of singing, followed by
    // nine seconds of nothing. The old rule handed the line all ten.
    const end = sungEnd(10, 20, 6, 0.2);
    expect(end).toBeLessThan(13);
    expect(end).toBeGreaterThan(11);
  });

  it('never reaches into the next line, however long the words', () => {
    expect(sungEnd(10, 11, 40, 0.3)).toBeLessThanOrEqual(11);
  });

  it('keeps a minimum length even for a single short word', () => {
    expect(sungEnd(10, 30, 1, 0.1)).toBeGreaterThanOrEqual(10.4);
  });
});

describe('placing the words of a line', () => {
  it('gives longer words more of the line', () => {
    const words = wordTimings('가 가나다라마 가', 0, 7);
    const spans = words.map((word) => word.endSec - word.startSec);
    expect(spans[1]).toBeGreaterThan(spans[0]!);
    expect(spans[0]).toBeCloseTo(spans[2]!, 5);
    expect(words.at(-1)?.endSec).toBeCloseTo(7, 5);
  });

  it('runs from the start of the line to the end of it', () => {
    const words = wordTimings('aaa bbb ccc', 4, 6);
    expect(words[0]?.startSec).toBeCloseTo(4, 5);
    expect(words.at(-1)?.endSec).toBeCloseTo(6, 5);
  });

  it('puts a tapped word exactly where it was tapped', () => {
    const words = wordTimings('aaa bbb ccc ddd', 0, 8, [null, 5, null, null]);
    expect(words[1]?.startSec).toBeCloseTo(5, 5);
    // …and everything before it now has to fit in the time before it.
    expect(words[0]?.endSec).toBeCloseTo(5, 5);
  });

  it('interpolates between two taps rather than across the whole line', () => {
    const words = wordTimings('aaa bbb ccc ddd', 0, 12, [null, 2, null, 4]);
    expect(words[2]!.startSec).toBeGreaterThan(2);
    expect(words[2]!.startSec).toBeLessThan(4);
    expect(words[3]?.startSec).toBeCloseTo(4, 5);
  });

  it('ignores a tap that cannot be true instead of reordering the words', () => {
    // Word four supposedly arrives before word two. One of them is a misfire;
    // honouring it would run the line backwards.
    const words = wordTimings('aaa bbb ccc ddd', 0, 10, [null, 6, null, 3]);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.startSec).toBeGreaterThanOrEqual(words[index - 1]!.startSec);
    }
    expect(words[1]?.startSec).toBeCloseTo(6, 5);
  });

  it('ignores taps outside the line', () => {
    const words = wordTimings('aaa bbb ccc', 2, 5, [null, 99, null]);
    expect(words[1]!.startSec).toBeLessThan(5);
    expect(words[1]!.startSec).toBeGreaterThan(2);
  });

  it('always moves forwards and always covers the line', () => {
    for (const anchors of [[], [null, 3], [1.5, null, 3, null], [null, null, null, 9]]) {
      const words = wordTimings('aaa bbb ccc ddd', 1, 10, anchors as (number | null)[]);
      expect(words[0]!.startSec).toBeGreaterThanOrEqual(1);
      expect(words.at(-1)!.endSec).toBeCloseTo(10, 5);
      for (const word of words) expect(word.endSec).toBeGreaterThanOrEqual(word.startSec);
    }
  });

  it('survives a line with no room at all', () => {
    const words = wordTimings('aaa bbb', 5, 5);
    expect(words).toHaveLength(2);
    for (const word of words) expect(Number.isFinite(word.startSec)).toBe(true);
  });
});

describe('the drift that was reported', () => {
  /*
   * The symptom: on a long line, the highlight falls further behind the
   * further into the line you get — even though the line itself was tapped
   * perfectly. The cause was the line being given every second up to the next
   * tap, including the pause after it.
   */
  const LONG = 'aaa bbb ccc ddd eee fff ggg hhh';

  it('no longer spreads a long line across the pause after it', () => {
    const rate = 0.2;
    const units = unitCount(LONG);
    const boundary = 30; // the next line is timed twenty seconds later
    const end = sungEnd(10, boundary, units, rate);
    const words = wordTimings(LONG, 10, end);

    // Eight one-syllable words at a fifth of a second is under two seconds of
    // singing, so the last word must land near the start of the gap, not in
    // the middle of it.
    expect(words.at(-1)!.endSec).toBeLessThan(13);

    const naive = wordTimings(LONG, 10, boundary);
    expect(naive.at(-1)!.startSec - words.at(-1)!.startSec).toBeGreaterThan(10);
  });

  it('is pinned exactly where a word was tapped, whatever the estimate', () => {
    const anchors = [null, null, null, null, 12.4, null, null, null];
    const words = wordTimings(LONG, 10, 14, anchors);
    expect(words[4]?.startSec).toBeCloseTo(12.4, 5);
  });
});
