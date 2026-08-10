import { describe, expect, it } from 'vitest';
import {
  parseSheet,
  sectionKindFor,
  suggestSections,
} from '@/transcription/providers/lyrics';

/**
 * Section handling, tested on invented placeholder lines so the fixtures carry
 * no real lyrics.
 */

const text = (...lines: string[]): string => lines.join('\n');

describe('section headings', () => {
  it('recognises the parts a song is made of', () => {
    expect(sectionKindFor('Verse 1')).toBe('verse');
    expect(sectionKindFor('Chorus')).toBe('chorus');
    expect(sectionKindFor('Hook')).toBe('chorus');
    expect(sectionKindFor('Bridge')).toBe('bridge');
    expect(sectionKindFor('Intro')).toBe('intro');
    expect(sectionKindFor('Outro')).toBe('outro');
    expect(sectionKindFor('Something else')).toBe('other');
  });

  it('reads pre-chorus as its own part, not as a chorus', () => {
    // "Pre-Chorus" contains "chorus", so order of matching matters.
    expect(sectionKindFor('Pre-Chorus')).toBe('pre-chorus');
    expect(sectionKindFor('Pre Hook')).toBe('pre-chorus');
    expect(sectionKindFor('Post-Chorus')).toBe('post-chorus');
  });

  it('assigns each line to the heading above it', () => {
    const { lines, sections } = parseSheet(
      text('[Verse 1]', 'aaa', 'bbb', '[Chorus]', 'ccc'),
    );
    expect(sections.map((s) => s.kind)).toEqual(['verse', 'chorus']);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.sectionId).toBe(sections[0]?.id);
    expect(lines[2]?.sectionId).toBe(sections[1]?.id);
  });

  it('accepts round brackets as well as square', () => {
    const { sections } = parseSheet(text('(Verse 1)', 'aaa'));
    expect(sections[0]?.kind).toBe('verse');
  });
});

describe('repeated sections', () => {
  it('copies the words back when a heading recurs empty', () => {
    // Type the hook once; name it again where it returns.
    const { lines, sections } = parseSheet(
      text('[Hook]', 'aaa', 'bbb', '[Verse 1]', 'ccc', '[Hook]'),
    );
    expect(sections).toHaveLength(3);
    expect(sections[2]?.repeatOf).toBe(sections[0]?.id);
    expect(lines.map((l) => l.text)).toEqual(['aaa', 'bbb', 'ccc', 'aaa', 'bbb']);
    expect(lines[3]?.sectionId).toBe(sections[2]?.id);
  });

  it('matches heading names loosely', () => {
    const { sections } = parseSheet(text('[Chorus]', 'aaa', '[chorus 2]', ''));
    expect(sections[1]?.repeatOf).toBe(sections[0]?.id);
  });

  it('leaves a repeat untimed rather than stacking it on the first', () => {
    // The crucial one: identical text in two places must not inherit the same
    // timestamp, or the whole chorus piles up at one moment in the song.
    const first = parseSheet(text('[Hook]', 'aaa', '[Verse 1]', 'bbb', '[Hook]'));
    const timed = first.lines.map((line, i) => (i === 0 ? { ...line, startSec: 10 } : line));

    const again = parseSheet(text('[Hook]', 'aaa', '[Verse 1]', 'bbb', '[Hook]'), {
      language: 'ko',
      audioKey: 'k',
      lines: timed,
      sections: first.sections,
    });

    expect(again.lines[0]?.startSec).toBe(10);
    expect(again.lines.at(-1)?.startSec).toBeNull();
  });

  it('does not copy into a repeat that has its own words', () => {
    const { lines } = parseSheet(text('[Hook]', 'aaa', '[Hook]', 'zzz'));
    expect(lines.map((l) => l.text)).toEqual(['aaa', 'zzz']);
  });
});

describe('detecting structure from the words alone', () => {
  it('finds the block that repeats and calls it the chorus', () => {
    const out = suggestSections(['v1', 'v2', 'h1', 'h2', 'v3', 'v4', 'h1', 'h2']);
    expect(out.filter((l) => l === '[Chorus]')).toHaveLength(2);
    expect(out.filter((l) => l.startsWith('[Verse'))).toHaveLength(2);
    // Every original line survives, in order.
    expect(out.filter((l) => !l.startsWith('['))).toEqual([
      'v1', 'v2', 'h1', 'h2', 'v3', 'v4', 'h1', 'h2',
    ]);
  });

  it('calls a lyric with no repetition a single verse rather than inventing parts', () => {
    const out = suggestSections(['a', 'b', 'c', 'd', 'e']);
    expect(out[0]).toBe('[Verse 1]');
    expect(out.filter((l) => l.startsWith('['))).toHaveLength(1);
  });

  it('leaves a very short lyric alone', () => {
    expect(suggestSections(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('prefers the longest repeating block', () => {
    const out = suggestSections(['x', 'h1', 'h2', 'h3', 'y', 'h1', 'h2', 'h3']);
    const chorusAt = out.indexOf('[Chorus]');
    expect(out.slice(chorusAt + 1, chorusAt + 4)).toEqual(['h1', 'h2', 'h3']);
  });
});
