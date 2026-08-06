import type { LanguageTag, Transcript, TranscriptSegment } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import { interpolateWordTimings, progressReporter, TranscriptionError } from '../provider';

/**
 * The lyric sheet: words you supply, timings you tap.
 *
 * Speech recognition is the wrong tool for learning a song you already have the
 * words to. You are not trying to find out what was sung — that is printed in
 * the liner notes. You are trying to find out how it is pronounced, where it
 * lands, and what it means. Whisper only guesses at the first of those, and on
 * fast rap over a dense mix it guesses badly.
 *
 * So this provider inverts the problem. You paste the lyrics, tap once per line
 * as the track plays, and the result is a transcript that is correct by
 * construction — no model, no confidence score, nothing to second-guess. Three
 * minutes of tapping beats an hour of correcting a machine.
 *
 * It implements the same `TranscriptionProvider` interface as Whisper, so
 * everything downstream — phonemizer, staff, inspector, export — cannot tell
 * the difference and needed no changes at all.
 */

export interface LyricLine {
  readonly text: string;
  /** Seconds. `null` until the line has been tapped. */
  readonly startSec: number | null;
}

export interface LyricSheet {
  readonly language: LanguageTag;
  readonly lines: readonly LyricLine[];
  /** Identifies which audio file these timings belong to. */
  readonly audioKey: string;
}

export function emptySheet(language: LanguageTag = 'ko'): LyricSheet {
  return { language, lines: [], audioKey: '' };
}

/** Split pasted text into lines, dropping blank ones and section headers. */
export function parseLyrics(raw: string, existing?: LyricSheet): LyricLine[] {
  const previous = new Map<string, number>();
  for (const line of existing?.lines ?? []) {
    if (line.startSec !== null) previous.set(line.text, line.startSec);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Section markers like [Verse 1] are structure, not words to sing.
    .filter((line) => line.length > 0 && !/^[[(].*[\])]$/.test(line))
    .map((text) => {
      const carried = previous.get(text);
      return { text, startSec: carried ?? null };
    });
}

/** A stable key for localStorage, so timings survive a reload. */
export function audioKeyFor(name: string, durationSec: number): string {
  return `${name}::${durationSec.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Persistence — tapping a song out is real work and should never be lost.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'beyond.sheet.';

export function saveSheet(sheet: LyricSheet): void {
  if (!sheet.audioKey) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + sheet.audioKey, JSON.stringify(sheet));
  } catch {
    // Quota or private browsing. Losing saved timings is bad; crashing is worse.
  }
}

export function loadSheet(audioKey: string): LyricSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + audioKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as LyricSheet;
    if (!Array.isArray(candidate.lines)) return null;
    return candidate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

let currentSheet: LyricSheet = emptySheet();

export function setSheet(sheet: LyricSheet): void {
  currentSheet = sheet;
}

export function getSheet(): LyricSheet {
  return currentSheet;
}

/** How long the final line runs for, when there is no next tap to bound it. */
const TRAILING_LINE_SEC = 6;

class LyricSheetProvider implements TranscriptionProvider {
  readonly id = 'lyrics';
  readonly label = 'My lyrics + tapped timing';
  readonly description =
    'You paste the words and tap along once per line. Exact, offline, and it handles rap no model can follow.';
  readonly requiresApiKey = false;
  readonly isLocal = true;

  async available(): Promise<{ ok: boolean; reason?: string }> {
    const timed = currentSheet.lines.filter((line) => line.startSec !== null);
    if (currentSheet.lines.length === 0) {
      return { ok: false, reason: 'Paste the lyrics first, then tap along to time them.' };
    }
    if (timed.length === 0) {
      return { ok: false, reason: 'No lines are timed yet — play the track and tap each line.' };
    }
    return { ok: true };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    report(0.5, 'Building the score from your lyric sheet…');

    // Only timed lines can be placed on the staff. Untimed ones are held back
    // rather than dropped — the panel keeps showing them as needing a tap.
    const timed = currentSheet.lines
      .map((line, index) => ({ ...line, index }))
      .filter((line): line is { text: string; startSec: number; index: number } =>
        line.startSec !== null,
      )
      .sort((a, b) => a.startSec - b.startSec);

    if (timed.length === 0) {
      throw new TranscriptionError('No lines have been timed yet.', this.id);
    }

    const segments: TranscriptSegment[] = timed.map((line, i) => {
      const next = timed[i + 1];
      const endSec = Math.min(
        next ? next.startSec : line.startSec + TRAILING_LINE_SEC,
        request.audio.durationSec,
      );
      return {
        id: `line-${line.index}`,
        text: line.text,
        startSec: line.startSec,
        endSec,
        // Within a line, words are spaced by character count. Korean is
        // syllable-timed, so this is a better approximation there than it is
        // for a stress-timed language like English.
        //
        // Confidence is 1: you typed these words. There is no model to doubt,
        // and marking them uncertain would be inventing a doubt that does not
        // exist.
        words: interpolateWordTimings(line.text, line.startSec, endSec).map((word) => ({
          ...word,
          confidence: 1,
        })),
      };
    });

    report(1, 'Score ready');

    return {
      language: request.language === 'auto' ? currentSheet.language : request.language,
      languageDetected: false,
      segments,
      providerId: this.id,
      modelId: 'user-supplied',
    };
  }
}

export const lyricsProvider = new LyricSheetProvider();
