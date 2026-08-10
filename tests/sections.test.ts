import { describe, expect, it } from 'vitest';
import {
  parseSheet,
  sectionKindFor,
  sectionSpans,
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

describe('section headings in other languages', () => {
  it('reads Korean headings', () => {
    expect(sectionKindFor('후렴')).toBe('chorus');
    expect(sectionKindFor('훅')).toBe('chorus');
    expect(sectionKindFor('코러스')).toBe('chorus');
    expect(sectionKindFor('벌스 1')).toBe('verse');
    expect(sectionKindFor('절')).toBe('verse');
    expect(sectionKindFor('브릿지')).toBe('bridge');
    expect(sectionKindFor('브리지')).toBe('bridge');
    expect(sectionKindFor('인트로')).toBe('intro');
    expect(sectionKindFor('아웃트로')).toBe('outro');
    expect(sectionKindFor('프리코러스')).toBe('pre-chorus');
  });

  it('reads Japanese headings, which have no English cognate', () => {
    // サビ is the chorus and Aメロ the verse — no amount of transliteration
    // would get there, so these need naming outright.
    expect(sectionKindFor('サビ')).toBe('chorus');
    expect(sectionKindFor('Aメロ')).toBe('verse');
    expect(sectionKindFor('Bメロ')).toBe('pre-chorus');
    expect(sectionKindFor('ブリッジ')).toBe('bridge');
    expect(sectionKindFor('イントロ')).toBe('intro');
  });

  it('reads Chinese, Spanish, French and German headings', () => {
    expect(sectionKindFor('副歌')).toBe('chorus');
    expect(sectionKindFor('主歌')).toBe('verse');
    expect(sectionKindFor('Estribillo')).toBe('chorus');
    expect(sectionKindFor('Verso 2')).toBe('verse');
    expect(sectionKindFor('Puente')).toBe('bridge');
    expect(sectionKindFor('Refrain')).toBe('refrain');
    expect(sectionKindFor('Couplet 1')).toBe('verse');
    expect(sectionKindFor('Strophe')).toBe('verse');
  });

  it('matches repeats of a non-Latin heading', () => {
    // The old key function stripped every non-Latin, non-Hangul character, so
    // two different Japanese headings both reduced to '' and collided.
    const { sections } = parseSheet(
      text('[サビ]', 'aaa', 'bbb', '[Aメロ]', 'ccc', '[サビ]'),
    );
    expect(sections[2]?.repeatOf).toBe(sections[0]?.id);
    // …and crucially, the verse must NOT be treated as a repeat of the chorus.
    expect(sections[1]?.repeatOf).toBeUndefined();
  });

  it('handles a sheet that mixes languages', () => {
    const { sections } = parseSheet(text('[Verse 1]', 'aaa', '[후렴]', 'bbb'));
    expect(sections.map((s) => s.kind)).toEqual(['verse', 'chorus']);
  });
});

describe('section spans on the timeline', () => {
  it('runs each section up to the start of the next', () => {
    const { lines, sections } = parseSheet(
      text('[Verse 1]', 'aaa', 'bbb', '[Hook]', 'ccc'),
    );
    const timed = lines.map((line, i) => ({ ...line, startSec: [5, 8, 20][i] ?? null }));
    const spans = sectionSpans(
      { language: 'ko', audioKey: 'k', lines: timed, sections },
      60,
    );
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ startSec: 5, endSec: 20 });
    expect(spans[1]).toMatchObject({ startSec: 20, endSec: 60 });
  });

  it('leaves out sections with nothing timed yet', () => {
    const { lines, sections } = parseSheet(text('[Verse 1]', 'aaa', '[Hook]', 'bbb'));
    const timed = lines.map((line, i) => ({ ...line, startSec: i === 0 ? 5 : null }));
    const spans = sectionSpans({ language: 'ko', audioKey: 'k', lines: timed, sections }, 60);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.section.kind).toBe('verse');
  });

  it('orders by time, not by position in the text', () => {
    // A repeated chorus is written last but may be tapped in the middle.
    const { lines, sections } = parseSheet(
      text('[Hook]', 'aaa', '[Verse 1]', 'bbb', '[Hook]'),
    );
    const timed = lines.map((line, i) => ({ ...line, startSec: [30, 10, 50][i] ?? null }));
    const spans = sectionSpans({ language: 'ko', audioKey: 'k', lines: timed, sections }, 60);
    expect(spans.map((s) => s.startSec)).toEqual([10, 30, 50]);
  });
});
