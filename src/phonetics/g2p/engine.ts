import type { LanguageTag, Phone, PronunciationSource } from '@/core/types';

export interface Pronunciation {
  readonly phones: readonly Phone[];
  readonly source: PronunciationSource;
  /** 0–1. Lexicon hits are 1; rule guesses sit around 0.5–0.75. */
  readonly confidence: number;
  /** Alternative pronunciations, best-first, as IPA strings. */
  readonly variants?: readonly string[];
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
