import { describe, expect, it } from 'vitest';
import {
  EmptyWriteError,
  parseProject,
  projectFileName,
  serializeProject,
  writeHandle,
} from '@/storage/project';
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
    const restored = parseProject(serializeProject(record)).track;
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
    expect(parseProject(serializeProject(record)).track.id).toBe('abc123-214');
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

describe('commits — a project with the song inside it', () => {
  const audio = {
    fileName: 'Please.mp3',
    mimeType: 'audio/mpeg',
    bytes: 6,
    // "BEYOND" as base64 — a stand-in for an MP3, exact bytes and all.
    data: 'QkVZT05E',
  };

  it('carries the song inside the project file', () => {
    const json = serializeProject(record, audio);
    const opened = parseProject(json);
    expect(opened.track.id).toBe(record.id);
    expect(opened.audioFileName).toBe('Please.mp3');
    expect(opened.audio).toBeInstanceOf(Blob);
    expect(opened.audio?.type).toBe('audio/mpeg');
    expect(opened.audio?.size).toBe(6);
  });

  it('gives back exactly the bytes it was handed', async () => {
    const opened = parseProject(serializeProject(record, audio));
    expect(await opened.audio?.text()).toBe('BEYOND');
  });

  it('marks itself as version 2, so an older reader can tell', () => {
    expect(JSON.parse(serializeProject(record, audio)).version).toBe(2);
    expect(JSON.parse(serializeProject(record)).version).toBe(1);
  });

  it('still opens a plain project file, which has no audio at all', () => {
    const opened = parseProject(serializeProject(record));
    expect(opened.track.sheet.lines).toHaveLength(3);
    expect(opened.audio).toBeNull();
    expect(opened.audioFileName).toBeNull();
  });

  it('keeps the work when the committed audio is corrupt', () => {
    // The words took a fortnight; the song can be picked again in a second.
    // Losing the first to protect the second would be exactly backwards.
    const broken = serializeProject(record, { ...audio, data: 'not base64 !!!' });
    const opened = parseProject(broken);
    expect(opened.track.sheet.lines).toHaveLength(3);
    expect(opened.audio).toBeNull();
  });

  it('gives every save file the same name shape', () => {
    // One kind of file now, so one extension. Anything written under the old
    // `.beyond-song.json` name still opens — the picker takes any .json and
    // the parser reads both versions.
    expect(projectFileName('Please')).toBe('Please.beyond.json');
    expect(projectFileName('안녕 / hi?')).toBe('hi.beyond.json');
  });
});

/**
 * A save that silently produces nothing.
 *
 * `showSaveFilePicker` creates the file the moment the dialog is confirmed, so
 * an empty file with the right name exists before anything is written to it.
 * Every failure after that point therefore looks exactly like success from the
 * outside, which is the worst possible shape for a bug in a save button: you
 * find out when you try to send the file somewhere and it is refused.
 */
describe('writing to a picked file', () => {
  /** Enough of a FileSystemFileHandle to write to, with a settable outcome. */
  function fakeHandle(options: {
    landed: boolean;
    throwOnWrite?: boolean;
    /** Fails the string write and succeeds the Blob retry. */
    landsAsBlob?: boolean;
  }) {
    let stored = 0;
    let closed = false;
    let attempts = 0;
    return {
      name: 'song.beyond.json',
      get closed() {
        return closed;
      },
      get attempts() {
        return attempts;
      },
      createWritable: () => {
        attempts += 1;
        return Promise.resolve({
          write: (data: string | Blob) => {
            if (options.throwOnWrite) return Promise.reject(new Error('disk went away'));
            const isBlob = typeof data !== 'string';
            if (options.landed || (options.landsAsBlob && isBlob)) {
              stored = isBlob ? data.size : data.length;
            }
            return Promise.resolve();
          },
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        });
      },
      getFile: () => Promise.resolve({ size: stored }),
    } as unknown as FileSystemFileHandle & { closed: boolean; attempts: number };
  }

  it('writes, and is happy when the bytes are there afterwards', async () => {
    const handle = fakeHandle({ landed: true });
    await expect(writeHandle(handle, '{"a":1}')).resolves.toBeUndefined();
  });

  it('refuses to call it saved when the file came out empty', async () => {
    // What a sync client does to a file being replaced under it: the write
    // reports success and the target is left at zero bytes.
    const handle = fakeHandle({ landed: false });
    await expect(writeHandle(handle, '{"a":1}')).rejects.toBeInstanceOf(EmptyWriteError);
  });

  it('closes the writable even when the write throws', async () => {
    // An unclosed writable leaves the swap file behind and the target at zero,
    // which is the very state this is all trying to avoid. The throw itself is
    // swallowed: a write that fails and a write that lands nothing are the
    // same outcome from here, and both end as EmptyWriteError after the retry.
    const handle = fakeHandle({ landed: false, throwOnWrite: true });
    await expect(writeHandle(handle, '{"a":1}')).rejects.toBeInstanceOf(EmptyWriteError);
    expect(handle.closed).toBe(true);
  });

  it('retries once as a Blob before giving up on the mechanism', async () => {
    // Some builds fail on a large string and manage the same bytes as a Blob,
    // so the second attempt is worth making before writing the whole route off.
    const handle = fakeHandle({ landed: false, landsAsBlob: true });
    await expect(writeHandle(handle, '{"a":1}')).resolves.toBeUndefined();
    expect(handle.attempts).toBe(2);
  });

  it('accepts an empty file when there was nothing to write', async () => {
    const handle = fakeHandle({ landed: true });
    await expect(writeHandle(handle, '')).resolves.toBeUndefined();
  });
});
