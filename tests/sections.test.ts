import { describe, expect, it } from 'vitest';
import {
  isHeadingLine,
  parseHeading,
  parseSheet,
  sectionKindFor,
  sectionSpans,
  sheetToText,
  upgradeSheet,
  type LyricLine,
  type LyricSection,
  type LyricSheet,
} from '@/transcription/providers/lyrics';

/**
 * Sections, tested on invented placeholder lines so the fixtures carry no real
 * lyrics. Headings are the real thing, since recognising them is the point.
 */

const text = (...lines: string[]): string => lines.join('\n');

const sheetOf = (
  lines: readonly LyricLine[],
  sections: readonly LyricSection[] = [],
): LyricSheet => ({ language: 'ko', audioKey: 'k', lines, sections });

describe('reading a heading', () => {
  it('splits the part from the people credited', () => {
    expect(parseHeading('Pre-Chorus: V, Jung Kook, Jin, Jimin')).toEqual({
      label: 'Pre-Chorus: V, Jung Kook, Jin, Jimin',
      name: 'Pre-Chorus',
      artists: ['V', 'Jung Kook', 'Jin', 'Jimin'],
    });
  });

  it('handles a heading with nobody named', () => {
    expect(parseHeading('Chorus')).toEqual({ label: 'Chorus', name: 'Chorus', artists: [] });
  });

  it('accepts the separators lyric sheets actually use', () => {
    expect(parseHeading('Bridge: Jin & V').artists).toEqual(['Jin', 'V']);
    expect(parseHeading('Verse 1: RM and SUGA').artists).toEqual(['RM', 'SUGA']);
    expect(parseHeading('후렴: 정국、지민').artists).toEqual(['정국', '지민']);
  });

  it('decides the kind from the part name, not the credits', () => {
    // "j-hope" must not be read as a hook, and a member's name must never
    // decide what kind of part this is.
    expect(sectionKindFor(parseHeading('Intro: j-hope').name)).toBe('intro');
    expect(sectionKindFor(parseHeading('Verse 2: RM, Jung Kook').name)).toBe('verse');
    expect(sectionKindFor(parseHeading('Pre-Chorus: V, Jimin').name)).toBe('pre-chorus');
  });

  it('knows a heading from a lyric', () => {
    expect(isHeadingLine('[Chorus]')).toBe(true);
    expect(isHeadingLine('(Verse 2)')).toBe(true);
    expect(isHeadingLine('aaa bbb')).toBe(false);
  });
});

describe('naming a part', () => {
  it('recognises the parts a song is made of', () => {
    expect(sectionKindFor('Verse 1')).toBe('verse');
    expect(sectionKindFor('Hook')).toBe('chorus');
    expect(sectionKindFor('Bridge')).toBe('bridge');
    expect(sectionKindFor('Outro')).toBe('outro');
    expect(sectionKindFor('Something else')).toBe('other');
  });

  it('reads pre-chorus as its own part, not as a chorus', () => {
    expect(sectionKindFor('Pre-Chorus')).toBe('pre-chorus');
    expect(sectionKindFor('Post-Chorus')).toBe('post-chorus');
  });

  it('reads Korean and Japanese names', () => {
    expect(sectionKindFor('후렴')).toBe('chorus');
    expect(sectionKindFor('벌스 1')).toBe('verse');
    expect(sectionKindFor('브릿지')).toBe('bridge');
    expect(sectionKindFor('サビ')).toBe('chorus');
    expect(sectionKindFor('Aメロ')).toBe('verse');
    expect(sectionKindFor('Bメロ')).toBe('pre-chorus');
  });

  it('keeps Refrain distinct from its Romance cousins', () => {
    expect(sectionKindFor('Refrain')).toBe('refrain');
    expect(sectionKindFor('Refrão')).toBe('chorus');
  });
});

describe('parsing a pasted lyric sheet', () => {
  it('gives every line the heading above it', () => {
    const { lines, sections } = parseSheet(
      text('[Intro: j-hope]', 'aaa', '[Verse 1: SUGA]', 'bbb', 'ccc'),
    );
    expect(sections.map((s) => s.name)).toEqual(['Intro', 'Verse 1']);
    expect(sections[0]?.artists).toEqual(['j-hope']);
    expect(lines.map((l) => l.sectionId)).toEqual([
      sections[0]?.id,
      sections[1]?.id,
      sections[1]?.id,
    ]);
  });

  it('accepts round brackets as well as square', () => {
    expect(parseSheet(text('(Verse 1)', 'aaa')).sections[0]?.kind).toBe('verse');
  });

  it('keeps lines written before any heading', () => {
    const { lines, sections } = parseSheet(text('aaa', '[Chorus]', 'bbb'));
    expect(lines[0]?.sectionId).toBeUndefined();
    expect(lines[1]?.sectionId).toBe(sections[0]?.id);
  });

  it('treats each heading on its own, however it is named', () => {
    // The rule that used to fold "Verse 2" into "Verse 1" is gone. A part that
    // returns is simply written out again, as every lyric sheet does.
    const { lines, sections } = parseSheet(
      text('[Verse 1]', 'aaa', '[Verse 2]', 'bbb', '[Chorus]', 'ccc', '[Chorus]', 'ccc'),
    );
    expect(sections).toHaveLength(4);
    expect(lines.map((l) => l.text)).toEqual(['aaa', 'bbb', 'ccc', 'ccc']);
    expect(lines[2]?.sectionId).not.toBe(lines[3]?.sectionId);
  });

  it('carries timings and translations through an edit', () => {
    const before = sheetOf([
      { text: 'aaa', startSec: 5, translation: 'x' },
      { text: 'bbb', startSec: 9 },
    ]);
    const after = parseSheet(text('[Chorus]', 'aaa', 'bbb', 'ccc'), before).lines;
    expect(after[0]).toMatchObject({ startSec: 5, translation: 'x' });
    expect(after[1]?.startSec).toBe(9);
    expect(after[2]?.startSec).toBeNull();
  });

  it('gives each occurrence of a repeated line back its own timing', () => {
    // A repeated chorus has the same words in several places, so a plain
    // text-to-value map cannot tell the second hook from the first.
    const before = sheetOf([
      { text: 'aaa', startSec: 5 },
      { text: 'bbb', startSec: 9 },
      { text: 'aaa', startSec: 40 },
    ]);
    const after = parseSheet(text('[Chorus]', 'aaa', 'bbb', '[Chorus]', 'aaa'), before).lines;
    expect(after.map((l) => l.startSec)).toEqual([5, 9, 40]);
  });

  it('leaves a newly added repeat untimed rather than stacking it', () => {
    const before = sheetOf([{ text: 'aaa', startSec: 5 }]);
    const after = parseSheet(text('[Hook]', 'aaa', '[Hook]', 'aaa'), before).lines;
    expect(after.map((l) => l.startSec)).toEqual([5, null]);
  });
});

describe('the editing box keeps what you typed', () => {
  it('writes the sheet back out as the text it was parsed from', () => {
    const raw = text('[Verse 1]', 'aaa', 'bbb', '[Chorus: Jimin]', 'ccc');
    const { lines, sections } = parseSheet(raw);
    expect(sheetToText(sheetOf(lines, sections))).toBe(raw);
  });

  it('round-trips a sheet whose headings the box would otherwise lose', () => {
    const raw = text('[Verse 1]', 'aaa', '[후렴]', 'bbb');
    const first = parseSheet(raw);
    const again = parseSheet(sheetToText(sheetOf(first.lines, first.sections)));
    expect(again.sections.map((s) => s.label)).toEqual(['Verse 1', '후렴']);
    expect(again.lines.map((l) => l.text)).toEqual(['aaa', 'bbb']);
  });
});

describe('where each part sits in the song', () => {
  it('runs each part up to the start of the next', () => {
    const { lines, sections } = parseSheet(text('[Verse 1]', 'aaa', 'bbb', '[Hook]', 'ccc'));
    const timed = lines.map((line, i) => ({ ...line, startSec: [5, 8, 20][i] ?? null }));
    const spans = sectionSpans(sheetOf(timed, sections), 60);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ startSec: 5, endSec: 20 });
    expect(spans[1]).toMatchObject({ startSec: 20, endSec: 60 });
  });

  it('leaves out a part with nothing timed yet', () => {
    const { lines, sections } = parseSheet(text('[Verse 1]', 'aaa', '[Hook]', 'bbb'));
    const timed = lines.map((line, i) => ({ ...line, startSec: i === 0 ? 5 : null }));
    const spans = sectionSpans(sheetOf(timed, sections), 60);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.section.kind).toBe('verse');
  });

  it('orders by time, not by position in the text', () => {
    const { lines, sections } = parseSheet(
      text('[Hook]', 'aaa', '[Verse 1]', 'bbb', '[Hook]', 'ccc'),
    );
    const timed = lines.map((line, i) => ({ ...line, startSec: [30, 10, 50][i] ?? null }));
    expect(sectionSpans(sheetOf(timed, sections), 60).map((s) => s.startSec)).toEqual([10, 30, 50]);
  });

  it('gives a repeated part a block each time it is written', () => {
    const { lines, sections } = parseSheet(
      text('[Chorus]', 'aaa', '[Verse]', 'bbb', '[Chorus]', 'aaa'),
    );
    const timed = lines.map((line, i) => ({ ...line, startSec: [10, 30, 50][i] ?? null }));
    const spans = sectionSpans(sheetOf(timed, sections), 70);
    expect(spans.map((s) => [s.section.name, s.startSec])).toEqual([
      ['Chorus', 10],
      ['Verse', 30],
      ['Chorus', 50],
    ]);
  });
});

describe('work saved by earlier versions survives', () => {
  it('keeps every line and timing from a hand-placed sheet', () => {
    // The model that had you place each part on the timeline yourself.
    const placed = {
      language: 'ko',
      audioKey: 'k',
      artists: [{ id: 'a1', name: 'SUGA' }],
      lines: [
        { text: 'hook one', startSec: 10, sectionId: 'h' },
        { text: 'hook two', startSec: 14, sectionId: 'h' },
        { text: 'verse one', startSec: 30, sectionId: 'v', artistId: 'a1' },
      ],
      sections: [
        {
          id: 'h',
          label: 'Hook',
          kind: 'chorus',
          occurrences: [{ id: 'o1', startSec: 8, endSec: 20 }],
        },
        {
          id: 'v',
          label: 'Verse 1',
          kind: 'verse',
          occurrences: [{ id: 'o2', startSec: 28, endSec: 50 }],
        },
      ],
    } as unknown as LyricSheet;

    const up = upgradeSheet(placed);
    expect(up.lines.map((l) => [l.text, l.startSec])).toEqual([
      ['hook one', 10],
      ['hook two', 14],
      ['verse one', 30],
    ]);
    expect(up.sections?.map((s) => s.name)).toEqual(['Hook', 'Verse 1']);
    // The credit you recorded survives, now in the heading where it belongs.
    expect(up.sections?.[1]?.artists).toEqual(['SUGA']);
    expect(sheetToText(up)).toContain('[Verse 1: SUGA]');
  });

  it('writes a replayed part out as real lines, at the times it was playing', () => {
    // A hook typed once and marked as returning at 1:40. The score contained
    // five lines; it must still contain the same five afterwards.
    const placed = {
      language: 'ko',
      audioKey: 'k',
      lines: [
        { text: 'hook one', startSec: 10, sectionId: 'h' },
        { text: 'hook two', startSec: 14, sectionId: 'h' },
        { text: 'verse one', startSec: 40, sectionId: 'v' },
      ],
      sections: [
        {
          id: 'h',
          label: 'Hook',
          kind: 'chorus',
          occurrences: [
            { id: 'o1', startSec: 8, endSec: 20 },
            { id: 'o2', startSec: 100, endSec: 120 },
          ],
        },
        {
          id: 'v',
          label: 'Verse 1',
          kind: 'verse',
          occurrences: [{ id: 'o3', startSec: 38, endSec: 60 }],
        },
      ],
    } as unknown as LyricSheet;

    const up = upgradeSheet(placed);
    expect(up.lines.map((l) => [l.text, l.startSec])).toEqual([
      ['hook one', 10],
      ['hook two', 14],
      ['verse one', 40],
      ['hook one', 102],
      ['hook two', 106],
    ]);
    // Three headings now: the hook is written where it happens, both times.
    expect(up.sections?.map((s) => s.name)).toEqual(['Hook', 'Verse 1', 'Hook']);
  });

  it('measures a replay from the performance that was tapped, not the earliest', () => {
    const placed = {
      language: 'ko',
      audioKey: 'k',
      lines: [{ text: 'hook one', startSec: 80, sectionId: 'h' }],
      sections: [
        {
          id: 'h',
          label: 'Hook',
          kind: 'chorus',
          occurrences: [
            { id: 'early', startSec: 8, endSec: 26 },
            { id: 'tapped', startSec: 78, endSec: 96 },
          ],
        },
      ],
    } as unknown as LyricSheet;
    expect(upgradeSheet(placed).lines.map((l) => l.startSec)).toEqual([10, 80]);
  });

  it('restores headings for a sheet whose text had lost them', () => {
    // Sections without headings in the box: the text is rebuilt from them, so
    // the buttons come back rather than the parts being lost.
    const placed = {
      language: 'ko',
      audioKey: 'k',
      lines: [{ text: 'aaa', startSec: 5, sectionId: 'h' }],
      sections: [{ id: 'h', label: 'Chorus', kind: 'chorus', occurrences: [] }],
    } as unknown as LyricSheet;
    const up = upgradeSheet(placed);
    expect(sheetToText(up)).toBe(text('[Chorus]', 'aaa'));
    expect(parseSheet(sheetToText(up)).sections[0]?.name).toBe('Chorus');
  });

  it('keeps a section that has its own words, however it was labelled', () => {
    // The oldest model flagged "Verse 2" as a repeat of "Verse 1" on the name
    // alone. Folding on that flag deleted the second verse.
    const oldest = {
      language: 'ko',
      audioKey: 'k',
      lines: [
        { text: 'verse one', startSec: 10, sectionId: 'v1' },
        { text: 'verse two', startSec: 30, sectionId: 'v2' },
      ],
      sections: [
        { id: 'v1', label: 'Verse 1', kind: 'verse' },
        { id: 'v2', label: 'Verse 2', kind: 'verse', repeatOf: 'v1' },
      ],
    } as unknown as LyricSheet;
    const up = upgradeSheet(oldest);
    expect(up.lines.map((l) => l.text)).toEqual(['verse one', 'verse two']);
    expect(up.sections?.map((s) => s.name)).toEqual(['Verse 1', 'Verse 2']);
  });

  it('leaves a sheet already in this shape alone', () => {
    const { lines, sections } = parseSheet(text('[Chorus]', 'aaa'));
    const current = sheetOf(lines, sections);
    expect(upgradeSheet(current)).toBe(current);
  });

  it('keeps loose lines that never had a heading', () => {
    const loose = {
      language: 'ko',
      audioKey: 'k',
      lines: [{ text: 'aaa', startSec: 5 }],
      sections: [],
    } as unknown as LyricSheet;
    expect(upgradeSheet(loose).lines.map((l) => l.text)).toEqual(['aaa']);
  });
});
