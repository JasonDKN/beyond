import type { ViewMode } from '@/core/store';
import type { LyricSheet } from '@/transcription/providers/lyrics';

/**
 * The library: every track you have worked on, kept apart from every other.
 *
 * Progress was already stored per track — what was missing was any way to see
 * it, resume it, or throw it away. This adds that, and moves the audio itself
 * into IndexedDB so a track reopens in one click rather than sending you back
 * to a file picker every session.
 *
 * Everything is local. Audio you supplied stays on your machine; nothing here
 * is uploaded, and nothing is fetched.
 */

export interface TrackRecord {
  /** Fingerprint of the audio — survives renaming and re-encoding. */
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly durationSec: number;
  readonly language: string;
  readonly mode: ViewMode;
  readonly sheet: LyricSheet;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Whether the audio blob is stored alongside. */
  readonly hasAudio: boolean;
  readonly bytes: number;
}

export interface TrackSummary extends Omit<TrackRecord, 'sheet'> {
  readonly totalLines: number;
  readonly timedLines: number;
}

const DB_NAME = 'beyond';
const DB_VERSION = 1;
const TRACKS = 'tracks';
const AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' });
      // Audio lives in its own store so listing the library never has to read
      // megabytes of blob just to draw a row.
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the library.'));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Library write failed.'));
      }),
  );
}

/** Is persistent storage available at all? Private windows may say no. */
export function libraryAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * List saved tracks.
 *
 * Deliberately throws rather than returning an empty array on failure. An
 * empty library and a library that could not be read look identical on screen,
 * and "no saved tracks" is a terrifying thing to show someone whose work is
 * actually fine — it invites them to start over and lose it for real. The
 * caller is expected to tell the difference.
 */
export async function listTracks(): Promise<TrackSummary[]> {
  if (!libraryAvailable()) {
    throw new Error('This browser has no storage available for the library.');
  }
  const records = await tx<TrackRecord[]>(TRACKS, 'readonly', (store) => store.getAll());
  return records
    .map((record) => {
      const lines = record.sheet?.lines ?? [];
      const { sheet: _sheet, ...rest } = record;
      return {
        ...rest,
        totalLines: lines.length,
        timedLines: lines.filter((line) => line.startSec !== null).length,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

interface Backup {
  readonly format: 'beyond-library';
  readonly version: 1;
  readonly exportedAt: string;
  readonly tracks: readonly TrackRecord[];
}

/**
 * Export every track's work as JSON.
 *
 * Audio is deliberately excluded: it is megabytes per song and you already
 * have the files. What is irreplaceable is the tapping — the timings, the
 * lyrics, the translations — and that is kilobytes. A backup you will actually
 * keep beats a complete one you will not.
 */
export async function exportLibrary(): Promise<string> {
  const records = await tx<TrackRecord[]>(TRACKS, 'readonly', (store) => store.getAll());
  const backup: Backup = {
    format: 'beyond-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    tracks: records.map((record) => ({ ...record, hasAudio: false, bytes: 0 })),
  };
  return JSON.stringify(backup, null, 2);
}

export interface RestoreResult {
  readonly restored: number;
  readonly skipped: number;
}

/**
 * Merge a backup back in.
 *
 * Never destructive: a track already present keeps whichever copy was updated
 * more recently, so restoring an old backup cannot roll back newer work. If
 * you want the backup's version, delete the track first.
 */
export async function importLibrary(json: string): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const backup = parsed as Partial<Backup>;
  if (backup.format !== 'beyond-library' || !Array.isArray(backup.tracks)) {
    throw new Error('That does not look like a Beyond library backup.');
  }

  let restored = 0;
  let skipped = 0;

  for (const record of backup.tracks) {
    if (!record?.id || !record.sheet) {
      skipped += 1;
      continue;
    }
    const existing = await getTrack(record.id);
    if (existing && existing.updatedAt >= record.updatedAt) {
      skipped += 1;
      continue;
    }
    // Keep whatever audio is already stored; the backup carries none.
    await tx(TRACKS, 'readwrite', (store) =>
      store.put({
        ...record,
        hasAudio: existing?.hasAudio ?? false,
        bytes: existing?.bytes ?? 0,
      }),
    );
    restored += 1;
  }

  return { restored, skipped };
}

export async function getTrack(id: string): Promise<TrackRecord | null> {
  if (!libraryAvailable()) return null;
  try {
    return (await tx<TrackRecord | undefined>(TRACKS, 'readonly', (store) => store.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function getTrackAudio(id: string): Promise<Blob | null> {
  if (!libraryAvailable()) return null;
  try {
    const row = await tx<{ id: string; blob: Blob } | undefined>(AUDIO, 'readonly', (store) =>
      store.get(id),
    );
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SaveTrackInput {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly durationSec: number;
  readonly language: string;
  readonly mode: ViewMode;
  readonly sheet: LyricSheet;
}

/**
 * Create or update a track's saved work.
 *
 * Deliberately a merge rather than a replace: `createdAt` and the stored audio
 * survive, so saving a tapped line never risks the recording it belongs to.
 */
export async function saveTrack(input: SaveTrackInput): Promise<void> {
  if (!libraryAvailable()) return;
  try {
    const existing = await getTrack(input.id);
    const now = Date.now();
    const record: TrackRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      hasAudio: existing?.hasAudio ?? false,
      bytes: existing?.bytes ?? 0,
    };
    await tx(TRACKS, 'readwrite', (store) => store.put(record));
  } catch {
    // Storage full or unavailable. The session keeps working in memory.
  }
}

export async function saveTrackAudio(id: string, blob: Blob): Promise<boolean> {
  if (!libraryAvailable()) return false;
  try {
    await tx(AUDIO, 'readwrite', (store) => store.put({ id, blob }));
    const existing = await getTrack(id);
    if (existing) {
      await tx(TRACKS, 'readwrite', (store) =>
        store.put({ ...existing, hasAudio: true, bytes: blob.size }),
      );
    }
    return true;
  } catch {
    // The commonest failure here is a full quota, and it must not take the
    // timings down with it — those are the irreplaceable part.
    return false;
  }
}

export async function touchTrack(id: string): Promise<void> {
  const existing = await getTrack(id);
  if (!existing) return;
  try {
    await tx(TRACKS, 'readwrite', (store) => store.put({ ...existing, updatedAt: Date.now() }));
  } catch {
    /* not worth surfacing */
  }
}

export async function deleteTrack(id: string): Promise<void> {
  if (!libraryAvailable()) return;
  try {
    await tx(TRACKS, 'readwrite', (store) => store.delete(id));
    await tx(AUDIO, 'readwrite', (store) => store.delete(id));
  } catch {
    /* nothing useful to do */
  }
}

/** Drop just the recording, keeping the timings — the usual way to free space. */
export async function deleteTrackAudio(id: string): Promise<void> {
  if (!libraryAvailable()) return;
  try {
    await tx(AUDIO, 'readwrite', (store) => store.delete(id));
    const existing = await getTrack(id);
    if (existing) {
      await tx(TRACKS, 'readwrite', (store) =>
        store.put({ ...existing, hasAudio: false, bytes: 0 }),
      );
    }
  } catch {
    /* nothing useful to do */
  }
}

export async function totalBytes(): Promise<number> {
  const tracks = await listTracks();
  return tracks.reduce((sum, track) => sum + (track.bytes || 0), 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Human "when", at the resolution that actually matters for a practice log.
 * Nobody needs a timestamp; they need to know whether this was today.
 */
export function formatWhen(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Adopt work saved before the library existed.
 *
 * Old sheets were keyed by file name and duration in localStorage. Those keys
 * cannot be turned into fingerprints without the audio, so they are carried
 * across the first time you open the matching song and the fingerprint is
 * known. Nothing is deleted from localStorage — if this goes wrong, the
 * original is still there.
 */
export function legacySheet(legacyKeyValue: string): LyricSheet | null {
  try {
    const raw = localStorage.getItem(`beyond.sheet.${legacyKeyValue}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const sheet = parsed as LyricSheet;
    return Array.isArray(sheet.lines) ? sheet : null;
  } catch {
    return null;
  }
}
