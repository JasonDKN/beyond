import { describe, expect, it } from 'vitest';
import { parseProject, projectFileName, serializeProject } from '@/storage/project';
import type { TrackRecord } from '@/storage/library';

/**
 * Project files are the durable copy of someone's work, so the round-trip has
 * to be exact and the parser has to refuse anything it does not understand
 * rather than half-loading it.
 */

const record: TrackRecord = {
  id: 'abc123-214',
  title: 'Practice track',
  fileName: 'practice track.mp3',
  durationSec: 214.4,
  language: 'ko',
  mode: 'learning',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
  hasAudio: true,
  bytes: 5_242_880,
  sheet: {
    language: 'ko',
    audioKey: 'abc123-214',
    lines: [
      { text: '노래는 좋아요', startSec: 12.5, translation: 'the song is good' },
      { text: '같이 가요', startSec: 15.25 },
      { text: '아직 안 했어요', startSec: null },
    ],
  },
};

describe('project files', () => {
  it('round-trips every part of the work', () => {
    const restored = parseProject(serializeProject(record));
    expect(restored.id).toBe(record.id);
    expect(restored.sheet.lines).toHaveLength(3);
    expect(restored.sheet.lines[0]?.startSec).toBe(12.5);
    expect(restored.sheet.lines[0]?.translation).toBe('the song is good');
    // An untimed line must stay untimed, not become 0 — which would place it
    // at the very start of the song.
    expect(restored.sheet.lines[2]?.startSec).toBeNull();
    expect(restored.mode).toBe('learning');
  });

  it('leaves the audio out', () => {
    const json = serializeProject(record);
    expect(json).not.toContain('hasAudio');
    expect(json).not.toContain('5242880');
    // Small enough to keep alongside your documents without thinking about it.
    expect(json.length).toBeLessThan(2000);
  });

  it('keeps the fingerprint, which is how the audio finds its way back', () => {
    expect(parseProject(serializeProject(record)).id).toBe('abc123-214');
  });

  it('refuses files it does not understand rather than half-loading them', () => {
    expect(() => parseProject('not json at all')).toThrow(/valid JSON/);
    expect(() => parseProject('{"format":"something-else"}')).toThrow(/Beyond project/);
    expect(() => parseProject('{"format":"beyond-project"}')).toThrow(/Beyond project/);
    // A library backup is a different shape and must not be mistaken for one.
    expect(() => parseProject('{"format":"beyond-library","tracks":[]}')).toThrow();
  });

  it('makes a filename safe without making it unrecognisable', () => {
    expect(projectFileName('Practice track')).toBe('Practice track.beyond.json');
    expect(projectFileName('a/b:c*d?')).toBe('abcd.beyond.json');
    expect(projectFileName('')).toBe('track.beyond.json');
  });
});
