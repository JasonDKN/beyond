import type {
  AudioSource,
  LanguageTag,
  ProgressHandler,
  Transcript,
  TranscriptSegment,
  TranscriptWord,
} from '@/core/types';
import { wordTimings } from './timing';

export interface TranscriptionRequest {
  readonly audio: AudioSource;
  /** `auto` asks the provider to detect the language. */
  readonly language: LanguageTag | 'auto';
  readonly onProgress?: ProgressHandler;
  readonly signal?: AbortSignal;
}

/**
 * A source of transcripts.
 *
 * Everything downstream — phonemization, syllabification, the staff — consumes
 * `Transcript` and nothing else, so swapping local Whisper for a cloud API, or
 * for a hand-typed lyric sheet, is a change to exactly one object.
 */
export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Whether the provider needs a key configured before it can be selected. */
  readonly requiresApiKey: boolean;
  /** Does this provider send audio off the device? Surfaced in the UI. */
  readonly isLocal: boolean;
  /** Cheap check — can this run right now, in this browser, as configured? */
  available(): Promise<{ ok: boolean; reason?: string }>;
  transcribe(request: TranscriptionRequest): Promise<Transcript>;
}

const providers = new Map<string, TranscriptionProvider>();

export function registerProvider(provider: TranscriptionProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): TranscriptionProvider | undefined {
  return providers.get(id);
}

export function listProviders(): TranscriptionProvider[] {
  return [...providers.values()];
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TranscriptionError';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers — every provider returns words, and every provider needs the
// same logic to turn those words into singable lines.
// ---------------------------------------------------------------------------

export interface GroupingOptions {
  /** A silence longer than this starts a new line. */
  readonly gapSec: number;
  /** Hard cap so a run-on passage still breaks somewhere sensible. */
  readonly maxWords: number;
  readonly maxDurationSec: number;
}

export const DEFAULT_GROUPING: GroupingOptions = {
  gapSec: 0.6,
  maxWords: 12,
  maxDurationSec: 8,
};

/**
 * Group a flat word stream into lines.
 *
 * Whisper's own segment boundaries follow sentence punctuation, which songs do
 * not have. Breath is the real unit of a lyric line, so we break on silence
 * first and on terminal punctuation second.
 */
export function groupWordsIntoSegments(
  words: readonly TranscriptWord[],
  options: GroupingOptions = DEFAULT_GROUPING,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current.at(-1)!;
    segments.push({
      id: `seg-${segments.length}`,
      text: current.map((word) => word.text).join(' '),
      startSec: first.startSec,
      endSec: last.endSec,
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    const previous = current.at(-1);
    if (previous) {
      const gap = word.startSec - previous.endSec;
      const spanTooLong = word.endSec - current[0]!.startSec > options.maxDurationSec;
      const endsSentence = /[.?!¡¿]$/.test(previous.text);
      if (gap >= options.gapSec || spanTooLong || current.length >= options.maxWords || endsSentence) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return segments;
}

/**
 * Fill in plausible per-word timings when a provider only gives segment-level
 * ones. Words are weighted by syllable count rather than letter count — see
 * `timing.ts`, where the weighing lives and the reasons are written down.
 */
export function interpolateWordTimings(
  text: string,
  startSec: number,
  endSec: number,
  anchors: readonly (number | null | undefined)[] = [],
): TranscriptWord[] {
  return wordTimings(text, startSec, endSec, anchors);
}

/** Guard against providers emitting zero-length or overlapping word spans. */
export function sanitizeWords(
  words: readonly TranscriptWord[],
  durationSec: number,
): TranscriptWord[] {
  const minimum = 0.04;
  return words
    .filter((word) => word.text.trim().length > 0)
    .map((word, index, all) => {
      const start = clamp(word.startSec, 0, durationSec);
      const nextStart = all[index + 1]?.startSec ?? durationSec;
      const end = clamp(Math.max(word.endSec, start + minimum), start + minimum, nextStart || durationSec);
      return { ...word, startSec: start, endSec: end };
    });
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max <= min ? min : max);
}

export function progressReporter(
  onProgress: ProgressHandler | undefined,
): (ratio: number | null, message: string) => void {
  return (ratio, message) => onProgress?.({ stage: 'transcribe', ratio, message });
}

export function audioLabel(audio: AudioSource): string {
  return audio.name.replace(/\.[^.]+$/, '');
}
