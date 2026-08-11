import type {
  LanguageTag,
  Notation,
  Phone,
  Syllable,
  PhoneticLine,
  PhoneticScore,
  PhoneticWord,
  Progress,
  ProgressHandler,
  Transcript,
  TranscriptSegment,
  TranscriptWord,
} from '@/core/types';
import { renderIpa } from './ipa';
import { normalizeWord } from './g2p/engine';
import { resolveG2P } from './registry';
import { syllabify } from './syllabify';
import {
  applySingingStyle,
  distributeDurations,
  DEFAULT_SINGING_OPTIONS,
  type SingingOptions,
} from './singing';

export interface PhonemizeOptions {
  readonly notation?: Notation;
  readonly syllableBreaks?: boolean;
  readonly stressMarks?: boolean;
  readonly singing?: SingingOptions;
  readonly onProgress?: ProgressHandler;
  readonly outputLanguage?: LanguageTag | null;
}

/**
 * Turn a transcript into a phonetic score.
 *
 * This is the seam between "what was sung" and "how it was sung". Everything
 * language-specific has already been delegated to the registered G2P engine, so
 * this function is the same for every language Beyond will ever support.
 */
export async function phonemize(
  transcript: Transcript,
  options: PhonemizeOptions = {},
): Promise<PhoneticScore> {
  const {
    notation = 'ipa',
    syllableBreaks = false,
    stressMarks = true,
    singing = DEFAULT_SINGING_OPTIONS,
    onProgress,
    outputLanguage = null,
  } = options;

  const engine = resolveG2P(transcript.language);
  report(onProgress, {
    stage: 'phonemize',
    ratio: 0,
    message: `Loading ${engine.label}…`,
  });
  await engine.load();

  const totalWords = transcript.segments.reduce((sum, seg) => sum + seg.words.length, 0);
  let processed = 0;

  const lines: PhoneticLine[] = transcript.segments.map((segment) => {
    const words = segment.words.map((word) => {
      processed += 1;
      if (processed % 25 === 0) {
        report(onProgress, {
          stage: 'phonemize',
          ratio: totalWords === 0 ? null : processed / totalWords,
          message: `Transcribing ${processed} of ${totalWords} words…`,
        });
      }
      return phonemizeWord(word, engine, { notation, syllableBreaks, stressMarks, singing });
    });

    return buildLine(segment, words);
  });

  report(onProgress, { stage: 'phonemize', ratio: 1, message: 'Phonetics complete' });

  return {
    title: 'Untitled',
    inputLanguage: transcript.language,
    outputLanguage,
    notation,
    lines,
    durationSec: lines.at(-1)?.endSec ?? 0,
    meta: {
      providerId: transcript.providerId,
      modelId: transcript.modelId,
      g2pEngineId: engine.id,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildLine(segment: TranscriptSegment, words: PhoneticWord[]): PhoneticLine {
  return {
    id: segment.id,
    text: segment.text.trim(),
    startSec: segment.startSec,
    endSec: segment.endSec,
    words,
    // A translation supplied with the source text rides along untouched.
    ...(segment.translation ? { translation: segment.translation } : {}),
  };
}

interface WordOptions {
  readonly notation: Notation;
  readonly syllableBreaks: boolean;
  readonly stressMarks: boolean;
  readonly singing: SingingOptions;
}

function phonemizeWord(
  word: TranscriptWord,
  engine: ReturnType<typeof resolveG2P>,
  options: WordOptions,
): PhoneticWord {
  const normalized = normalizeWord(word.text);
  const pronunciation = engine.pronounce(normalized);

  const timed = distributeDurations(pronunciation.phones, word.startSec, word.endSec);
  const phones = applySingingStyle(timed, options.singing);

  // An engine that knows its own syllable structure beats a generic
  // syllabifier. Korean's writing system declares the boundaries outright, so
  // inferring them from sonority would be strictly worse — and for a
  // syllable-timed language those boundaries drive the rhythm display too.
  const syllables = pronunciation.syllables
    ? retimeSyllables(pronunciation.syllables, phones)
    : syllabify(phones);

  const ipa = renderIpa(syllables, {
    notation: options.notation,
    syllableBreaks: options.syllableBreaks,
    stressMarks: options.stressMarks,
  });

  // Final confidence blends how sure the ASR was that this is the right word
  // with how sure the G2P engine is about its pronunciation. Both have to be
  // high for the result to be trustworthy, so they multiply rather than average.
  const asrConfidence = word.confidence ?? 0.9;
  const confidence = Number((asrConfidence * pronunciation.confidence).toFixed(3));

  const base: PhoneticWord = {
    text: word.text,
    normalized,
    ipa,
    phones,
    syllables,
    source: pronunciation.source,
    confidence,
    startSec: word.startSec,
    endSec: word.endSec,
  };

  // Morphology, where the engine offers it. Done here rather than inside
  // pronounce() because it answers a different question — what the word means
  // rather than how it sounds — and a language can want one without the other.
  const morphemes = engine.analyze?.(normalized) ?? [];

  return {
    ...base,
    ...(morphemes.length > 1 ? { morphemes } : {}),
    ...(pronunciation.variants?.length ? { variants: pronunciation.variants } : {}),
    ...(pronunciation.respelling ? { respelling: pronunciation.respelling } : {}),
    ...(pronunciation.pronouncedForm ? { pronouncedForm: pronunciation.pronouncedForm } : {}),
    ...(pronunciation.changed !== undefined ? { changed: pronunciation.changed } : {}),
    ...(pronunciation.notes?.length ? { notes: pronunciation.notes } : {}),
  };
}

/**
 * Reattach playback timings to engine-supplied syllables.
 *
 * The engine builds syllables before anything is known about the audio; the
 * timing pass then walks the flat phone list. This zips them back together by
 * position so the syllables carry the same timed phones the staff draws.
 */
function retimeSyllables(
  syllables: readonly Syllable[],
  timedPhones: readonly Phone[],
): Syllable[] {
  let cursor = 0;
  const take = (count: number): Phone[] => {
    const slice = timedPhones.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  };
  return syllables.map((syllable) => ({
    onset: take(syllable.onset.length),
    nucleus: take(syllable.nucleus.length),
    coda: take(syllable.coda.length),
    stress: syllable.stress,
  }));
}

/** Re-render an existing score with different display options — no re-run of G2P. */
export function restyleScore(
  score: PhoneticScore,
  options: Pick<PhonemizeOptions, 'notation' | 'syllableBreaks' | 'stressMarks'>,
): PhoneticScore {
  const notation = options.notation ?? score.notation;
  const lines = score.lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({
      ...word,
      ipa: renderIpa(word.syllables, {
        notation,
        syllableBreaks: options.syllableBreaks ?? false,
        stressMarks: options.stressMarks ?? true,
      }),
    })),
  }));
  return { ...score, notation, lines };
}

function report(handler: ProgressHandler | undefined, progress: Progress): void {
  handler?.(progress);
}
