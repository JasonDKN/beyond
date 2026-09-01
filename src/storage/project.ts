import type { LyricSheet } from '@/transcription/providers/lyrics';
import type { ViewMode } from '@/core/store';
import { saveTrack, type TrackRecord } from './library';

/**
 * Project files: your work as a real file, in a real folder.
 *
 * Browser storage is convenient and invisible, which is exactly its problem —
 * it is scoped to an origin, so a dev server on a different port looks like
 * every track has been deleted. A file in a folder you chose has none of that
 * fragility: it survives ports, browsers, reinstalls, and gets swept up by
 * whatever backs up the rest of your documents.
 *
 * The file holds the irreplaceable part — lyrics, timings, translations — and
 * the song itself along with it.
 *
 * It did not always. There were two kinds of file: a small one holding just
 * the work, on the reasoning that the audio is megabytes of something you
 * already have and the fingerprint will find it again; and a larger one with
 * the song folded in, for carrying a track to a device that had never seen it.
 *
 * That was a distinction nobody should have had to learn, and it had a trap
 * in it. "You already have the audio" is true on the machine you are sitting
 * at and false everywhere else — and everywhere else is precisely where a save
 * file is going. The small file was quietly useless in the situation that
 * makes you reach for one.
 *
 * So there is one file, and it is the complete one. A song too large to fold
 * in (see MAX_EMBED_BYTES) still saves; that file asks for its audio once on
 * the far end, which is the old behaviour and the rare case rather than the
 * default one.
 *
 * The audio rides as base64, which costs a third more bytes than the raw file
 * and saves writing a zip container and its reader. For one song that trade is
 * obviously right; it is why save files are per song rather than per library.
 */

/*
 * One extension, because there is one kind of save file.
 *
 * There used to be a second — `.beyond-song.json` — for the variant that
 * carried the audio. Files written with it still open: the picker accepts any
 * `.json` and the parser reads both versions. Nothing new is named that way.
 */
export const PROJECT_EXTENSION = '.beyond.json';

/** Audio carried inside a project file, for moving a song between devices. */
interface EmbeddedAudio {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: number;
  /** The file itself, base64-encoded. */
  readonly data: string;
}

interface ProjectFile {
  readonly format: 'beyond-project';
  /** 1 is work only; 2 may also carry the audio. Both still open. */
  readonly version: 1 | 2;
  readonly savedAt: string;
  readonly audio?: EmbeddedAudio;
  readonly track: {
    readonly id: string;
    readonly title: string;
    readonly fileName: string;
    readonly durationSec: number;
    readonly language: string;
    readonly mode: ViewMode;
    readonly sheet: LyricSheet;
    readonly createdAt: number;
    readonly updatedAt: number;
  };
}

export function serializeProject(record: TrackRecord, audio?: EmbeddedAudio): string {
  const project: ProjectFile = {
    format: 'beyond-project',
    version: audio ? 2 : 1,
    savedAt: new Date().toISOString(),
    ...(audio ? { audio } : {}),
    track: {
      id: record.id,
      title: record.title,
      fileName: record.fileName,
      durationSec: record.durationSec,
      language: record.language,
      mode: record.mode,
      sheet: record.sheet,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
  return JSON.stringify(project, null, 2);
}

export interface OpenedProject {
  readonly track: ProjectFile['track'];
  /** Present when the file carried the song inside it. */
  readonly audio: Blob | null;
  readonly audioFileName: string | null;
}

export function parseProject(json: string): OpenedProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const project = parsed as Partial<ProjectFile>;
  if (project.format !== 'beyond-project' || !project.track?.sheet) {
    throw new Error('That does not look like a Beyond project file.');
  }

  // A version 1 file has no audio and never did; that is not a fault. Files
  // written under older names still open, whatever they are called.
  const packed = project.audio;
  if (!packed?.data) {
    return { track: project.track, audio: null, audioFileName: null };
  }

  try {
    return {
      track: project.track,
      audio: decodeAudio(packed),
      audioFileName: packed.fileName,
    };
  } catch {
    // Corrupt audio must not cost you the work, which is the part that took a
    // fortnight. Open the project and let the fingerprint ask for the song.
    return { track: project.track, audio: null, audioFileName: null };
  }
}

/**
 * The largest song we will fold into a save file.
 *
 * Base64 costs a third on top, and `JSON.stringify` then copies the whole
 * string again, so the peak cost of embedding is roughly three times the
 * source. Forty megabytes of audio is about two hours of ordinary MP3 — far
 * past any song — and keeps that peak somewhere a browser tab is comfortable.
 *
 * Past it, the save still happens: it just carries the work and leaves the
 * song behind, which is the old behaviour and a great deal better than a tab
 * that dies halfway through saving.
 */
export const MAX_EMBED_BYTES = 40 * 1024 * 1024;

/** Wrap a file up so it can travel inside a save file. */
export async function embedAudio(blob: Blob, fileName: string): Promise<EmbeddedAudio> {
  return {
    fileName,
    mimeType: blob.type || 'audio/mpeg',
    bytes: blob.size,
    data: await toBase64(blob),
  };
}

function decodeAudio(packed: EmbeddedAudio): Blob {
  const binary = atob(packed.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: packed.mimeType });
}

/**
 * Base64 a blob without blowing the call stack.
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-liner everybody writes and
 * it throws on anything over about a hundred kilobytes, because every byte
 * becomes an argument. A FileReader hands the whole thing over as a data URL
 * in one go, and the browser does the encoding in native code.
 */
async function toBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That audio file could not be read.'));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? '' : dataUrl.slice(comma + 1);
}

/** A safe, recognisable filename for a track. */
export function projectFileName(title: string): string {
  const safe = title.replace(/[^\w\-. ]+/g, '').trim() || 'track';
  return `${safe}${PROJECT_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// File System Access
// ---------------------------------------------------------------------------

/**
 * Chrome and Edge can write to a file you picked, repeatedly, without asking
 * again. Firefox and Safari cannot, and fall back to download-and-upload —
 * the same data either way, just more clicks.
 */
export function canWriteFiles(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

interface PickerWindow {
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
}

const PROJECT_TYPE = {
  description: 'Beyond project',
  accept: { 'application/json': ['.json'] },
};

/** Ask where to save, and write. Returns the handle so later saves are silent. */
export async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!canWriteFiles()) return null;
  try {
    return await (globalThis as unknown as PickerWindow).showSaveFilePicker({
      suggestedName,
      types: [PROJECT_TYPE],
    });
  } catch {
    // The picker throws on cancel, which is not an error worth reporting.
    return null;
  }
}

export async function pickOpenHandle(): Promise<FileSystemFileHandle | null> {
  if (!canWriteFiles()) return null;
  try {
    const [handle] = await (globalThis as unknown as PickerWindow).showOpenFilePicker({
      multiple: false,
      types: [PROJECT_TYPE],
    });
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Write to a picked file, and check that it actually landed.
 *
 * `showSaveFilePicker` creates the file the moment you confirm the dialog, so
 * an empty file exists before a single byte is written. If anything then goes
 * wrong — and on Windows something does, because `createWritable` works by
 * writing to a swap file and renaming it over the target, which sync clients
 * like OneDrive and Dropbox are known to interfere with — what you are left
 * with is a real file, with the right name, containing nothing.
 *
 * That is the worst possible failure for a save: it looks exactly like success.
 * You only find out when you try to send the file somewhere and it is refused
 * for being empty, by which time you may have closed the song.
 *
 * So this reads the file back and refuses to call it saved unless something is
 * in it. Callers can then fall back to a plain download, which goes through the
 * browser's own download machinery and does not touch the file system directly.
 */
export async function writeHandle(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    // Always close, even if the write threw — an unclosed writable leaves the
    // swap file behind and the target at zero.
    await writable.close();
  }

  const written = await handle.getFile();
  if (contents.length > 0 && written.size === 0) {
    throw new EmptyWriteError(handle.name);
  }
}

/** A write that reported success and produced an empty file. */
export class EmptyWriteError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName} was written but came out empty.`);
    this.name = 'EmptyWriteError';
  }
}

// ---------------------------------------------------------------------------

/**
 * Bring a project into the library.
 *
 * This always writes, unlike the bulk backup restore, which keeps whichever
 * copy is newer. The difference is intent: restoring a backup is a sweep over
 * many tracks where "don't clobber newer work" is the safe default, whereas
 * opening a project file is you pointing at one file and saying load this.
 * Second-guessing that with a timestamp comparison would mean the app quietly
 * refusing to open the file you just chose.
 *
 * Whatever was open is saved before this runs, so nothing is lost either way.
 */
export async function adoptProject(track: ProjectFile['track']): Promise<{
  id: string;
  title: string;
  fileName: string;
}> {
  await saveTrack({
    id: track.id,
    title: track.title,
    fileName: track.fileName,
    durationSec: track.durationSec,
    language: track.language,
    mode: track.mode,
    sheet: track.sheet,
  });

  return { id: track.id, title: track.title, fileName: track.fileName };
}
