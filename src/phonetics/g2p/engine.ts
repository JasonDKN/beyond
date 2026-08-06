import type {
  LanguageTag,
  Morpheme,
  Phone,
  PronunciationNote,
  PronunciationSource,
  Syllable,
} from '@/core/types';

export interface Pronunciation {
  readonly phones: readonly Phone[];
  readonly source: PronunciationSource;
  /** 0–1. Lexicon hits are 1; rule guesses sit around 0.5–0.75. */
  readonly confidence: number;
  /** Alternative pronunciations, best-first, as IPA strings. */
  readonly variants?: readonly string[];

  /**
   * Syllables, when the engine knows them better than a generic syllabifier
   * would. Korean does: the writing system declares syllable boundaries
   * outright, so inferring them from sonority would be strictly worse.
   */
  readonly syllables?: readonly Syllable[];

  /** A plain-alphabet reading for learners who do not read IPA yet. */
  readonly respelling?: string;

  /**
   * The word rewritten in its own script as it is actually *said*, when that
   * differs from how it is spelled. Korean 좋아요 → 조아요, French liaison,
   * Japanese rendaku. Showing this next to the spelling is often the single
   * most useful thing a phonetic tool can do for a learner.
   */
  readonly pronouncedForm?: string;

  /** True when `pronouncedForm` differs from what was written. */
  readonly changed?: boolean;

  /** Which sound rules fired, so the interface can explain rather than assert. */
  readonly notes?: readonly PronunciationNote[];
}

/**
 * A grapheme-to-phoneme engine for one or more languages.
 *
 * Adding a language means writing one of these and registering it — nothing
 * upstream (audio, ASR) or downstream (syllabification, rendering, the staff)
 * needs to know it exists.
 */
export interface G2PEngine {
  readonly id: string;
  readonly label: string;
  /** BCP-47 tags this engine claims. `en` also matches `en-US`, `en-GB`, … */
  readonly languages: readonly LanguageTag[];
  /** Roughly how much this engine can be trusted, for UI messaging. */
  readonly quality: 'lexicon' | 'rules' | 'placeholder';
  /** Pull in any large assets. Idempotent; safe to await repeatedly. */
  load(): Promise<void>;
  /** Convert a single normalized word to phones. */
  pronounce(word: string): Pronunciation;
  /**
   * Break a word into its meaningful parts, where the language works that way.
   *
   * Optional, because it is only worth doing for languages that stack grammar
   * onto a stem — Korean, Japanese, Turkish, Finnish. English mostly does not,
   * so the English engine leaves this undefined and nothing downstream cares.
   */
  analyze?(word: string): readonly Morpheme[];
}

/** `en-US` → `en`. Comparison is always done on the primary subtag. */
export function primarySubtag(tag: LanguageTag): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? tag.toLowerCase();
}

/**
 * Strip punctuation and case for lookup, while keeping the marks that are
 * part of a word: internal apostrophes (`don't`) and hyphens (`well-worn`).
 * Combining accents are preserved — `canción` must not become `cancion` for a
 * Spanish engine, even though English lookup would not care.
 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '')
    .replace(/[^\p{L}\p{N}'\-.]/gu, '');
}
