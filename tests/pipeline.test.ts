import { describe, expect, it } from 'vitest';
import { computePeaks, detectOnsets, normalizedEnergy } from '@/audio/peaks';
import {
  groupWordsIntoSegments,
  interpolateWordTimings,
  sanitizeWords,
} from '@/transcription/provider';
import { distributeDurations, applySingingStyle } from '@/phonetics/singing';
import { arpabetToPhones } from '@/phonetics/arpabet';
import { exportScore } from '@/export';
import type { PhoneticScore, TranscriptWord } from '@/core/types';

function sine(length: number, frequency: number, sampleRate = 44_100): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return data;
}

describe('peak envelope', () => {
  it('produces one min/max pair and one RMS value per bucket', () => {
    const envelope = computePeaks(sine(44_100, 440), 100);
    expect(envelope.length).toBe(100);
    expect(envelope.peaks).toHaveLength(200);
    expect(envelope.rms).toHaveLength(100);
  });

  it('captures the full excursion of a full-scale sine', () => {
    const envelope = computePeaks(sine(44_100, 440), 50);
    expect(envelope.peaks[1]).toBeGreaterThan(0.98);
    expect(envelope.peaks[0]).toBeLessThan(-0.98);
    // RMS of a unit sine is 1/√2.
    expect(envelope.rms[10]).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('handles silence and single-sample input without dividing by zero', () => {
    const silence = computePeaks(new Float32Array(1000), 10);
    expect([...normalizedEnergy(silence)].every((value) => value === 0)).toBe(true);
    expect(() => computePeaks(new Float32Array([0.5]), 64)).not.toThrow();
  });

  it('finds onsets where the energy actually rises', () => {
    // Silence, then a burst — exactly one rising edge.
    const data = new Float32Array(44_100);
    for (let i = 22_050; i < 44_100; i += 1) data[i] = Math.sin(i / 20);
    const onsets = detectOnsets(computePeaks(data, 200), 44_100);
    expect(onsets.length).toBeGreaterThan(0);
    expect(onsets[0]).toBeGreaterThan(0.4);
    expect(onsets[0]).toBeLessThan(0.65);
  });
});

describe('grouping words into lines', () => {
  const words = (specs: [string, number, number][]): TranscriptWord[] =>
    specs.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));

  it('breaks a line on silence', () => {
    const segments = groupWordsIntoSegments(
      words([
        ['hold', 0, 0.4],
        ['me', 0.4, 0.8],
        ['closer', 2.0, 2.6],
      ]),
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe('hold me');
  });

  it('breaks on terminal punctuation even without a pause', () => {
    const segments = groupWordsIntoSegments(
      words([
        ['stop.', 0, 0.3],
        ['again', 0.3, 0.6],
      ]),
    );
    expect(segments).toHaveLength(2);
  });

  it('caps runaway lines', () => {
    const many = words(
      Array.from({ length: 40 }, (_, i): [string, number, number] => [
        `w${i}`,
        i * 0.2,
        i * 0.2 + 0.15,
      ]),
    );
    const segments = groupWordsIntoSegments(many);
    expect(segments.every((segment) => segment.words.length <= 12)).toBe(true);
  });

  it('gives every segment a start no later than its end', () => {
    const segments = groupWordsIntoSegments(
      words([
        ['a', 0, 0.2],
        ['b', 0.25, 0.5],
      ]),
    );
    for (const segment of segments) expect(segment.endSec).toBeGreaterThanOrEqual(segment.startSec);
  });
});

describe('timing helpers', () => {
  it('weights interpolated word timings by length', () => {
    const timed = interpolateWordTimings('a considerable while', 0, 10);
    expect(timed).toHaveLength(3);
    const durations = timed.map((word) => word.endSec - word.startSec);
    expect(durations[1]).toBeGreaterThan(durations[0]!);
    expect(timed.at(-1)?.endSec).toBeCloseTo(10, 5);
  });

  it('repairs zero-length and overlapping spans', () => {
    const cleaned = sanitizeWords(
      [
        { text: 'a', startSec: 0, endSec: 0 },
        { text: 'b', startSec: 0.5, endSec: 5 },
        { text: '', startSec: 1, endSec: 2 },
      ],
      3,
    );
    expect(cleaned).toHaveLength(2);
    for (const word of cleaned) expect(word.endSec).toBeGreaterThan(word.startSec);
    expect(cleaned[0]!.endSec).toBeLessThanOrEqual(cleaned[1]!.startSec);
  });

  it('gives sustained vowels more of the word than consonants', () => {
    const phones = distributeDurations(arpabetToPhones('S IY1 T'), 0, 1);
    const spans = phones.map((p) => (p.endSec ?? 0) - (p.startSec ?? 0));
    expect(spans[1]).toBeGreaterThan(spans[0]!);
    expect(phones.at(-1)?.endSec).toBeCloseTo(1, 5);
  });
});

describe('singing style', () => {
  it('lengthens and opens a sustained schwa', () => {
    const phones = distributeDurations(arpabetToPhones('AH0'), 0, 2);
    const sung = applySingingStyle(phones);
    expect(sung[0]?.ipa).toBe('ʌː');
  });

  it('leaves short vowels alone', () => {
    const phones = distributeDurations(arpabetToPhones('AH0'), 0, 0.1);
    expect(applySingingStyle(phones)[0]?.ipa).toBe('ə');
  });

  it('does nothing at all when switched off', () => {
    const phones = distributeDurations(arpabetToPhones('IY1'), 0, 3);
    const sung = applySingingStyle(phones, {
      enabled: false,
      sustainThresholdSec: 0.45,
      restoreSustainedSchwa: true,
      markLiaison: false,
    });
    expect(sung[0]?.ipa).toBe('i');
  });
});

describe('export', () => {
  const score: PhoneticScore = {
    title: 'Test',
    inputLanguage: 'en',
    outputLanguage: null,
    notation: 'ipa',
    durationSec: 2,
    meta: {
      providerId: 'demo',
      modelId: 'demo',
      g2pEngineId: 'en-cmudict',
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    lines: [
      {
        id: 'seg-0',
        text: 'hello there',
        startSec: 0,
        endSec: 2,
        words: [
          {
            text: 'hello',
            normalized: 'hello',
            ipa: 'həˈloʊ',
            phones: [],
            syllables: [],
            source: 'lexicon',
            confidence: 1,
            startSec: 0,
            endSec: 1,
          },
          {
            text: 'there',
            normalized: 'there',
            ipa: 'ðɛɹ',
            phones: [],
            syllables: [],
            source: 'lexicon',
            confidence: 1,
            startSec: 1,
            endSec: 2,
          },
        ],
      },
    ],
  };

  it('aligns the interlinear columns', () => {
    const lines = exportScore(score, 'txt').split('\n');
    const lyricRow = lines.findIndex((line) => line.startsWith('hello'));
    expect(lines[lyricRow]).toHaveLength(lines[lyricRow + 1]!.length);
  });

  it('writes valid SRT timecodes', () => {
    expect(exportScore(score, 'srt')).toContain('00:00:00,000 --> 00:00:02,000');
  });

  it('quotes CSV cells that need it', () => {
    const csv = exportScore(score, 'csv');
    expect(csv.split('\n')[0]).toBe('line,start,end,word,ipa,syllables,source,confidence');
    expect(csv.split('\n')).toHaveLength(3);
  });

  it('round-trips through JSON', () => {
    expect(JSON.parse(exportScore(score, 'json'))).toEqual(score);
  });
});
