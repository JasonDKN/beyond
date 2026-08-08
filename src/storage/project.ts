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
 * not the audio, which would be megabytes of something you already have. On
 * opening a project the audio is found in the library by fingerprint, or asked
 * for once and then cached, after which it opens in a click.
 */

export const PROJECT_EXTENSION = '.beyond.json';

interface ProjectFile {
  readonly format: 'beyond-project';
  readonly version: 1;
  readonly savedAt: string;
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

export function serializeProject(record: TrackRecord): string {
  const project: ProjectFile = {
    format: 'beyond-project',
    version: 1,
    savedAt: new Date().toISOString(),
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

export function parseProject(json: string): ProjectFile['track'] {
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
  return project.track;
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

export async function writeHandle(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
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
