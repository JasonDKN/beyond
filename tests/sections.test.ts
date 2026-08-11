import { describe, expect, it } from 'vitest';
import {
  countMarkerLines,
  isMarkerLine,
  occurrenceOffsets,
  placeLinesWithOverflow,
  parseLyrics,
  placeLines,
  sectionKindFor,
  sectionSpans,
  upgradeSheet,
  type LyricLine,
  type LyricSection,
  type LyricSheet,
} from '@/transcription/providers/lyrics';
import { parseClock } from '@/ui/compartmentalize';
import { assignLanes } from '@/ui/sectionBar';

/**
 * Sections, artists and repeats — tested on invented placeholder lines so the
 * fixtures carry no real lyrics.
 */

const text = (...lines: string[]): string => lines.join('\n');

const sheetOf = (
  lines: readonly LyricLine[],
  sections: readonly LyricSection[] = [],
): LyricSheet => ({ language: 'ko', audioKey: 'k', lines, sections, artists: [] });

const occ = (id: string, startSec: number, endSec: number) => ({ id, startSec, endSec });

describe('naming a section', () => {
  it('reads the kind out of the name you typed', () => {
    expect(sectionKindFor('Verse 1')).toBe('verse');
    expect(sectionKindFor('Hook')).toBe('chorus');
    expect(sectionKindFor('Bridge')).toBe('bridge');
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

describe('pasted text is only ever lyrics', () => {
  it('drops bracketed markers instead of turning them into sections', () => {
    // Structure is made by hand now. A marker is still not a lyric, though —
    // putting [Verse 1] on the staff to be pronounced would be worse.
    const lines = parseLyrics(text('[Verse 1]', 'aaa', '(Hook)', 'bbb'));
    expect(lines.map((l) => l.text)).toEqual(['aaa', 'bbb']);
    expect(countMarkerLines(text('[Verse 1]', 'aaa', '(Hook)', 'bbb'))).toBe(2);
  });

  it('knows a marker from a lyric', () => {
    expect(isMarkerLine('[Chorus]')).toBe(true);
    expect(isMarkerLine('(Verse 2)')).toBe(true);
    expect(isMarkerLine('aaa bbb')).toBe(false);
  });

  it('carries section, artist, timing and translation through an edit', () => {
    const before = sheetOf([
      { text: 'aaa', startSec: 5, sectionId: 'sec-1', artistId: 'art-1', translation: 'x' },
      { text: 'bbb', startSec: 9, sectionId: 'sec-1' },
    ]);
    const after = parseLyrics(text('aaa', 'bbb', 'ccc'), before);

    expect(after[0]).toMatchObject({
      startSec: 5,
      sectionId: 'sec-1',
      artistId: 'art-1',
      translation: 'x',
    });
    expect(after[1]).toMatchObject({ startSec: 9, sectionId: 'sec-1' });
    // A brand-new line arrives bare.
    expect(after[2]).toEqual({ text: 'ccc', startSec: null });
  });

  it('gives each occurrence of a repeated line back its own timing', () => {
    // A text -> value map cannot tell one performance from another, which is
    // how timings used to end up shuffled onto the wrong lines.
    const before = sheetOf([
      { text: 'aaa', startSec: 5 },
      { text: 'bbb', startSec: 9 },
      { text: 'aaa', startSec: 40 },
    ]);
    const after = parseLyrics(text('aaa', 'bbb', 'aaa'), before);
    expect(after.map((l) => l.startSec)).toEqual([5, 9, 40]);
  });

  it('leaves a newly added duplicate untimed rather than stacking it', () => {
    const before = sheetOf([{ text: 'aaa', startSec: 5 }]);
    const after = parseLyrics(text('aaa', 'aaa'), before);
    expect(after.map((l) => l.startSec)).toEqual([5, null]);
  });
});

describe('where a section sits in the song', () => {
  const hook: LyricSection = {
    id: 'sec-1',
    label: 'Hook',
    kind: 'chorus',
    occurrences: [occ('o1', 45, 60), occ('o2', 150, 165)],
  };

  it('gives every occurrence its own block, in time order', () => {
    const sheet = sheetOf([{ text: 'aaa', startSec: 46, sectionId: 'sec-1' }], [hook]);
    const spans = sectionSpans(sheet, 200);
    expect(spans.map((s) => [s.startSec, s.endSec, s.occurrenceIndex])).toEqual([
      [45, 60, 0],
      [150, 165, 1],
    ]);
  });

  it('leaves out a section that has not been placed yet', () => {
    const unplaced: LyricSection = { id: 'sec-2', label: 'Verse', kind: 'verse', occurrences: [] };
    expect(sectionSpans(sheetOf([], [unplaced]), 200)).toEqual([]);
  });

  it('clips an occurrence that runs past the end of the track', () => {
    const spans = sectionSpans(sheetOf([], [hook]), 155);
    expect(spans.at(-1)?.endSec).toBe(155);
  });

  it('measures a repeat from the performance that was tapped', () => {
    const { referenceIndex, offsets } = occurrenceOffsets(hook, [46]);
    expect(referenceIndex).toBe(0);
    expect(offsets).toEqual([0, 105]);
  });

  it('finds the tapped performance even when it is not the first', () => {
    // Marking an earlier occurrence after tapping a later one used to shift
    // every repeat off the wrong base: the line vanished from where it really
    // is and appeared where nothing is sung.
    const { referenceIndex, offsets } = occurrenceOffsets(hook, [151]);
    expect(referenceIndex).toBe(1);
    expect(offsets).toEqual([-105, 0]);
  });
});

describe('one tap pass covers every repeat', () => {
  const hook: LyricSection = {
    id: 'sec-1',
    label: 'Hook',
    kind: 'chorus',
    occurrences: [occ('o1', 45, 60), occ('o2', 150, 165), occ('o3', 200, 215)],
  };

  const lines: LyricLine[] = [
    { text: 'hook one', startSec: 45, sectionId: 'sec-1' },
    { text: 'hook two', startSec: 50, sectionId: 'sec-1' },
  ];

  it('replays the tapped lines at each later occurrence, shifted', () => {
    const placed = placeLines(sheetOf(lines, [hook]));
    expect(placed.map((p) => [p.text, p.startSec])).toEqual([
      ['hook one', 45],
      ['hook two', 50],
      ['hook one', 150],
      ['hook two', 155],
      ['hook one', 200],
      ['hook two', 205],
    ]);
  });

  it('keeps the gap between the occurrence start and the first line', () => {
    // The hook starts at 0:45 but its first word lands at 0:47 — a two second
    // pickup that must survive into every repeat.
    const late = [{ text: 'hook one', startSec: 47, sectionId: 'sec-1' }];
    const placed = placeLines(sheetOf(late, [hook]));
    expect(placed.map((p) => p.startSec)).toEqual([47, 152, 202]);
  });

  it('does not duplicate a section performed only once', () => {
    const once: LyricSection = { ...hook, occurrences: [occ('o1', 45, 60)] };
    expect(placeLines(sheetOf(lines, [once]))).toHaveLength(2);
  });

  it('leaves loose lines exactly where they were tapped', () => {
    const placed = placeLines(sheetOf([{ text: 'aaa', startSec: 12 }]));
    expect(placed.map((p) => p.startSec)).toEqual([12]);
  });

  it('holds back lines that have not been timed', () => {
    const placed = placeLines(sheetOf([{ text: 'aaa', startSec: null, sectionId: 'sec-1' }], [hook]));
    expect(placed).toEqual([]);
  });

  it('gives a line its section artist unless it says otherwise', () => {
    const sung: LyricSection = { ...hook, occurrences: [occ('o1', 45, 60)], artistId: 'rm' };
    const placed = placeLines(
      sheetOf(
        [
          { text: 'hook one', startSec: 45, sectionId: 'sec-1' },
          { text: 'hook two', startSec: 50, sectionId: 'sec-1', artistId: 'jimin' },
        ],
        [sung],
      ),
    );
    expect(placed.map((p) => p.artistId)).toEqual(['rm', 'jimin']);
  });
});

describe('sheets saved by an older version', () => {
  it('turns a copied repeat back into a second occurrence', () => {
    // Old shape: the repeat was its own section holding duplicated words.
    const legacy = {
      language: 'ko',
      audioKey: 'k',
      lines: [
        { text: 'hook one', startSec: 45, sectionId: 'a' },
        { text: 'hook two', startSec: 50, sectionId: 'a' },
        { text: 'verse one', startSec: 70, sectionId: 'b' },
        { text: 'hook one', startSec: 150, sectionId: 'c' },
        { text: 'hook two', startSec: 155, sectionId: 'c' },
      ],
      sections: [
        { id: 'a', label: 'Hook', kind: 'chorus' },
        { id: 'b', label: 'Verse 1', kind: 'verse' },
        { id: 'c', label: 'Hook', kind: 'chorus', repeatOf: 'a' },
      ],
    } as unknown as LyricSheet;

    const upgraded = upgradeSheet(legacy);

    // The repeat is gone as a section...
    expect(upgraded.sections?.map((s) => s.id)).toEqual(['a', 'b']);
    // ...and survives as a second place the hook happens.
    const hook = upgraded.sections?.find((s) => s.id === 'a');
    expect(hook?.occurrences.map((o) => o.startSec)).toEqual([45, 150]);
    // The duplicated lines are dropped, because they are now generated.
    expect(upgraded.lines.map((l) => l.text)).toEqual(['hook one', 'hook two', 'verse one']);
    // And the score still covers both performances.
    expect(placeLines(upgraded).map((p) => p.startSec)).toEqual([45, 50, 70, 150, 155]);
  });

  it('gives an un-repeated old section a position from its timings', () => {
    const legacy = {
      language: 'ko',
      audioKey: 'k',
      lines: [{ text: 'aaa', startSec: 20, sectionId: 'a' }],
      sections: [{ id: 'a', label: 'Verse', kind: 'verse' }],
    } as unknown as LyricSheet;

    const hook = upgradeSheet(legacy).sections?.[0];
    expect(hook?.occurrences[0]?.startSec).toBe(20);
    expect(hook?.occurrences[0]?.endSec).toBeGreaterThan(20);
  });

  it('leaves a sheet already in the new shape alone', () => {
    const current = sheetOf(
      [{ text: 'aaa', startSec: 5, sectionId: 'sec-1' }],
      [{ id: 'sec-1', label: 'Hook', kind: 'chorus', occurrences: [occ('o1', 5, 12)] }],
    );
    expect(upgradeSheet(current)).toBe(current);
  });
});

describe('typing a timestamp', () => {
  it('reads the shapes people actually type', () => {
    expect(parseClock('1:23')).toBe(83);
    expect(parseClock('0:05')).toBe(5);
    expect(parseClock('83')).toBe(83);
    expect(parseClock('1:23.5')).toBe(83.5);
    expect(parseClock(' 2:00 ')).toBe(120);
  });

  it('refuses what is not a time', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('-4')).toBeNull();
  });
});

describe('stacking parts that overlap', () => {
  const span = (startSec: number, endSec: number) => ({ startSec, endSec });

  it('keeps a tidy song on one row', () => {
    expect(assignLanes([span(0, 10), span(10, 20), span(20, 30)])).toEqual([0, 0, 0]);
  });

  it('drops an overlapping part onto the next row', () => {
    // The reported bug: ends that run into the next part's start drew every
    // block at the same height, on top of each other.
    expect(assignLanes([span(0, 10), span(8, 26), span(24, 40), span(30, 52)])).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('opens a third row only when three parts are live at once', () => {
    expect(assignLanes([span(0, 30), span(5, 30), span(10, 30)])).toEqual([0, 1, 2]);
    expect(assignLanes([span(0, 30), span(5, 30), span(31, 40)])).toEqual([0, 1, 0]);
  });

  it('treats touching parts as adjacent, not overlapping', () => {
    // Floating point: an end of 10 and a start of 10 must not cost a row.
    expect(assignLanes([span(0, 10), span(10.0000001, 20)])).toEqual([0, 0]);
  });

  it('reuses the earliest free row', () => {
    const lanes = assignLanes([span(0, 100), span(1, 5), span(6, 10)]);
    expect(lanes).toEqual([0, 1, 1]);
  });

  it('handles nothing at all', () => {
    expect(assignLanes([])).toEqual([]);
  });
});

describe('a repeat only ever fills its own window', () => {
  const hook: LyricSection = {
    id: 'hook',
    label: 'Hook',
    kind: 'chorus',
    occurrences: [occ('o1', 8, 26), occ('o2', 100, 118)],
  };

  it('places a repeat inside the block you marked', () => {
    const sheet = sheetOf([{ text: 'Baby, oh, please', startSec: 15, sectionId: 'hook' }], [hook]);
    expect(placeLines(sheet).map((p) => p.startSec)).toEqual([15, 107]);
  });

  it('refuses to put a replayed line outside its block, and says so', () => {
    // A window shorter than the part it repeats. The tail would land past the
    // end of the block, where nobody sings it — that is the shape of "words
    // appearing where they do not belong", so it is reported, not placed.
    const tight: LyricSection = { ...hook, occurrences: [occ('o1', 8, 26), occ('o2', 100, 104)] };
    const sheet = sheetOf(
      [
        { text: 'hook one', startSec: 10, sectionId: 'hook' },
        { text: 'hook two', startSec: 22, sectionId: 'hook' },
      ],
      [tight],
    );
    const { placed, overflowed } = placeLinesWithOverflow(sheet);
    expect(placed.map((p) => `${p.text}@${p.startSec}`)).toEqual([
      'hook one@10',
      'hook two@22',
      'hook one@102',
    ]);
    expect(overflowed).toHaveLength(1);
    expect(overflowed[0]).toMatchObject({ text: 'hook two', wouldBeAtSec: 114 });
  });

  it('marks a replayed line as a repeat and a tapped one as not', () => {
    const sheet = sheetOf([{ text: 'hook one', startSec: 15, sectionId: 'hook' }], [hook]);
    expect(placeLines(sheet).map((p) => p.isRepeat)).toEqual([false, true]);
  });

  it('keeps a line that sits just before the block, as the tapped one did', () => {
    // The reference window is drawn 2s after the first tap, so the repeat's
    // line sits 2s before its block too. A rigid shift is symmetric, and
    // dropping that would silently lose the first line of every repeat.
    const tight: LyricSection = { ...hook, occurrences: [occ('o1', 12, 30), occ('o2', 100, 118)] };
    const sheet = sheetOf([{ text: 'hook one', startSec: 10, sectionId: 'hook' }], [tight]);
    expect(placeLines(sheet).map((p) => p.startSec)).toEqual([10, 98]);
  });
});

describe('an old sheet whose parts were merely named alike', () => {
  const legacy = {
    language: 'ko',
    audioKey: 'k',
    lines: [
      { text: 'verse one line A', startSec: 10, sectionId: 'v1' },
      { text: 'verse one line B', startSec: 13, sectionId: 'v1' },
      { text: 'verse two line C', startSec: 30, sectionId: 'v2' },
      { text: 'verse two line D', startSec: 33, sectionId: 'v2' },
    ],
    sections: [
      { id: 'v1', label: 'Verse 1', kind: 'verse' },
      // The old parser matched headings on their letters alone, so this was
      // flagged a repeat of Verse 1 despite having entirely different words.
      { id: 'v2', label: 'Verse 2', kind: 'verse', repeatOf: 'v1' },
    ],
  } as unknown as LyricSheet;

  it('keeps a section that has its own words, however it was labelled', () => {
    const up = upgradeSheet(legacy);
    expect(up.lines.map((l) => l.text)).toEqual([
      'verse one line A',
      'verse one line B',
      'verse two line C',
      'verse two line D',
    ]);
    expect(up.sections?.map((s) => s.label)).toEqual(['Verse 1', 'Verse 2']);
  });

  it('does not replay the first verse over the second', () => {
    expect(placeLines(upgradeSheet(legacy)).map((p) => p.text)).toEqual([
      'verse one line A',
      'verse one line B',
      'verse two line C',
      'verse two line D',
    ]);
  });

  it('still folds a genuine repeat, which carries a copy of the words', () => {
    const withRepeat = {
      ...legacy,
      lines: [
        { text: 'hook one', startSec: 10, sectionId: 'a' },
        { text: 'hook one', startSec: 40, sectionId: 'c' },
      ],
      sections: [
        { id: 'a', label: 'Hook', kind: 'chorus' },
        { id: 'c', label: 'Hook', kind: 'chorus', repeatOf: 'a' },
      ],
    } as unknown as LyricSheet;
    const up = upgradeSheet(withRepeat);
    expect(up.sections).toHaveLength(1);
    expect(up.sections?.[0]?.occurrences.map((o) => o.startSec)).toEqual([10, 40]);
    expect(up.lines).toHaveLength(1);
  });
});
