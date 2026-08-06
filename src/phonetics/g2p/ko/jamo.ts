/**
 * Hangul, taken apart.
 *
 * Hangul is the rare writing system that is algorithmically composed: every
 * syllable block in the range U+AC00–U+D7A3 is exactly
 *
 *     0xAC00 + (initial × 588) + (medial × 28) + final
 *
 * so decomposing 학 into ㅎ + ㅏ + ㄱ is arithmetic, not a lookup table. That
 * is why Korean needs no pronouncing dictionary the way English does — the
 * spelling already tells you the phonemes. What it does *not* tell you is the
 * sound changes that apply between them, which is what `phonology.ts` handles.
 */

export const INITIALS = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export const MEDIALS = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

/** Index 0 is "no final consonant", which is why this list starts empty. */
export const FINALS = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const MEDIAL_COUNT = MEDIALS.length; // 21
const FINAL_COUNT = FINALS.length; // 28

/**
 * A Hangul syllable block, split into its three slots.
 *
 * `coda` is '' when the block has no final consonant. `source` keeps the
 * original character so the UI can always show what was written next to what
 * is actually said — the comparison is the entire point of the app.
 */
export interface Jamo {
  onset: string;
  nucleus: string;
  coda: string;
  readonly source: string;
}

/** Two-consonant finals, and the pieces they split into under liaison. */
export const CLUSTER_FINALS: Readonly<Record<string, readonly [string, string]>> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};

export function isHangulSyllable(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code >= SYLLABLE_BASE && code <= SYLLABLE_LAST;
}

export function hasHangul(text: string): boolean {
  return [...text].some(isHangulSyllable);
}

/** Split one composed syllable block into its jamo. Returns null for anything else. */
export function decompose(char: string): Jamo | null {
  const code = char.codePointAt(0);
  if (code === undefined || code < SYLLABLE_BASE || code > SYLLABLE_LAST) return null;

  const offset = code - SYLLABLE_BASE;
  const finalIndex = offset % FINAL_COUNT;
  const medialIndex = Math.floor(offset / FINAL_COUNT) % MEDIAL_COUNT;
  const initialIndex = Math.floor(offset / (FINAL_COUNT * MEDIAL_COUNT));

  return {
    onset: INITIALS[initialIndex] ?? 'ㅇ',
    nucleus: MEDIALS[medialIndex] ?? 'ㅏ',
    coda: FINALS[finalIndex] ?? '',
    source: char,
  };
}

/** Rebuild a syllable block from jamo — used to show the pronounced spelling. */
export function compose(jamo: Pick<Jamo, 'onset' | 'nucleus' | 'coda'> & { source?: string }): string {
  const initialIndex = INITIALS.indexOf(jamo.onset as (typeof INITIALS)[number]);
  const medialIndex = MEDIALS.indexOf(jamo.nucleus as (typeof MEDIALS)[number]);
  const finalIndex = FINALS.indexOf(jamo.coda as (typeof FINALS)[number]);
  // An unrecognised jamo cannot be recomposed; fall back to what was written.
  if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) return jamo.source ?? '';
  return String.fromCodePoint(
    SYLLABLE_BASE + (initialIndex * MEDIAL_COUNT + medialIndex) * FINAL_COUNT + finalIndex,
  );
}

/**
 * Decompose a whole word. Non-Hangul characters (Latin, digits, the English
 * that runs through most K-pop lyrics) come back as null so the caller can
 * decide what to do with them rather than having them silently dropped.
 */
export function decomposeWord(word: string): (Jamo | null)[] {
  return [...word].map((char) => decompose(char) ?? null);
}
