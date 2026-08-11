import { beforeAll, describe, expect, it } from 'vitest';
import {
  canRead,
  loadReadings,
  needsLatinEngine,
  readLine,
  readWord,
  scriptOf,
  splitWords,
} from '@/phonetics/readings';
import '@/phonetics/registry';

/**
 * Readings, tested on invented placeholder syllables rather than real lyrics —
 * except where a specific sound rule is the thing under test.
 */

beforeAll(async () => {
  await loadReadings('ko', true);
});

describe('working out how a word is written', () => {
  it('knows a syllabary from an alphabet from a logograph', () => {
    expect(scriptOf('가나다')).toBe('syllabic');
    expect(scriptOf('サビ')).toBe('syllabic');
    expect(scriptOf('please')).toBe('alphabetic');
    expect(scriptOf('主歌')).toBe('logographic');
    expect(scriptOf('123')).toBe('other');
  });

  it('ignores punctuation when deciding', () => {
    // A leading quote must not make a Korean word look like "other".
    expect(scriptOf('"가나다"')).toBe('syllabic');
    expect(scriptOf('(please)')).toBe('alphabetic');
  });

  it('keeps the spaces when splitting a line', () => {
    expect(splitWords('가나 다라')).toEqual(['가나', ' ', '다라']);
  });
});

describe('reading a syllabary', () => {
  it('puts a sound under every block', () => {
    const reading = readWord('가나다', 'ko');
    expect(reading.script).toBe('syllabic');
    expect(reading.units.map((u) => u.text)).toEqual(['가', '나', '다']);
    expect(reading.units.every((u) => u.ipa.length > 0)).toBe(true);
  });

  it('carries a sound across a boundary the way the language does', () => {
    // 곳이 — the ㅅ moves onto the following vowel, so the second block is not
    // read as a bare 이. This is the whole reason to show it per block.
    const units = readWord('곳이', 'ko').units;
    expect(units).toHaveLength(2);
    expect(units[1]?.ipa).not.toBe(units[0]?.ipa);
  });

  it('falls back to the whole word when blocks and sounds disagree', () => {
    // Whatever happens, a word never comes back with more units than it has
    // characters, which is what a bad alignment would look like.
    const reading = readWord('안녕하세요', 'ko');
    expect(reading.units.length).toBeLessThanOrEqual(5);
    expect(reading.units.map((u) => u.text).join('')).toBe('안녕하세요');
  });
});

describe('reading an alphabet', () => {
  it('reads a Latin word whole rather than letter by letter', () => {
    const reading = readWord('please', 'en');
    expect(reading.script).toBe('alphabetic');
    expect(reading.units).toHaveLength(1);
    expect(reading.units[0]?.text).toBe('please');
  });

  it('reads English inside a Korean lyric with the English engine', () => {
    // The real case: a K-pop line with an English hook in it. Asking the
    // Korean engine gives the letters back unchanged, which looks like an
    // answer and is not one.
    const reading = readWord('please', 'ko');
    expect(reading.units[0]?.ipa).not.toBe('please');
    expect(reading.units[0]?.ipa.length).toBeGreaterThan(0);
  });

  it('keeps the punctuation in what is shown, out of what is looked up', () => {
    const reading = readWord('Baby,', 'ko');
    expect(reading.units[0]?.text).toBe('Baby,');
    expect(reading.units[0]?.ipa).not.toContain(',');
  });

  it('notices when a sheet needs the Latin engine', () => {
    expect(needsLatinEngine('Baby oh please', 'ko')).toBe(true);
    expect(needsLatinEngine('가나다 라마바', 'ko')).toBe(false);
    // An English song never needs a second engine for its own words.
    expect(needsLatinEngine('Baby oh please', 'en')).toBe(false);
  });
});

describe('reading a whole line', () => {
  it('gives one entry per word and drops the gaps', () => {
    const reading = readLine('가나 다라 please', 'ko');
    expect(reading.map((w) => w.word)).toEqual(['가나', '다라', 'please']);
  });

  it('mixes scripts within one line', () => {
    expect(readLine('네가 Baby', 'ko').map((w) => w.script)).toEqual(['syllabic', 'alphabetic']);
  });

  it('says nothing for a language no engine claims', () => {
    expect(canRead('ja')).toBe(false);
    expect(canRead('ko')).toBe(true);
  });
});
