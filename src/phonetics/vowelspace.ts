import type { PhoneticWord, Phone } from '@/core/types';

/**
 * The IPA vowel quadrilateral, as coordinates.
 *
 * This is the hinge the whole visual design turns on. The IPA vowel chart is
 * already a two-dimensional map — height (how close the tongue is to the roof
 * of the mouth) on one axis, backness on the other. A musical staff is also a
 * map, with pitch on the vertical.
 *
 * Beyond overlays them. A word's notehead sits high on the staff when its
 * stressed vowel is close ([i] in *see*) and low when it is open ([ɑ] in
 * *father*), so the contour drawn through a lyric is a real trace of what the
 * singer's mouth did. It is not pitch — it is the shape of the vowel, which is
 * the thing a phonetic transcription is actually about.
 *
 * Values: height 0 (open) → 1 (close); backness 0 (front) → 1 (back).
 */
export interface VowelPosition {
  readonly height: number;
  readonly backness: number;
  readonly rounded: boolean;
}

export const VOWEL_SPACE: Readonly<Record<string, VowelPosition>> = {
  // Close
  i: { height: 1, backness: 0, rounded: false },
  y: { height: 1, backness: 0, rounded: true },
  ɨ: { height: 1, backness: 0.5, rounded: false },
  ʉ: { height: 1, backness: 0.5, rounded: true },
  ɯ: { height: 1, backness: 1, rounded: false },
  u: { height: 1, backness: 1, rounded: true },
  // Near-close
  ɪ: { height: 0.85, backness: 0.2, rounded: false },
  ʏ: { height: 0.85, backness: 0.2, rounded: true },
  ʊ: { height: 0.85, backness: 0.8, rounded: true },
  // Close-mid
  e: { height: 0.7, backness: 0, rounded: false },
  ø: { height: 0.7, backness: 0, rounded: true },
  ɘ: { height: 0.7, backness: 0.5, rounded: false },
  ɵ: { height: 0.7, backness: 0.5, rounded: true },
  ɤ: { height: 0.7, backness: 1, rounded: false },
  o: { height: 0.7, backness: 1, rounded: true },
  // Mid
  ə: { height: 0.55, backness: 0.5, rounded: false },
  ɚ: { height: 0.55, backness: 0.5, rounded: false },
  // Open-mid
  ɛ: { height: 0.4, backness: 0.1, rounded: false },
  œ: { height: 0.4, backness: 0.1, rounded: true },
  ɜ: { height: 0.4, backness: 0.5, rounded: false },
  ɝ: { height: 0.4, backness: 0.5, rounded: false },
  ʌ: { height: 0.4, backness: 0.9, rounded: false },
  ɔ: { height: 0.4, backness: 1, rounded: true },
  // Near-open
  æ: { height: 0.25, backness: 0.1, rounded: false },
  ɐ: { height: 0.25, backness: 0.5, rounded: false },
  // Open
  a: { height: 0, backness: 0, rounded: false },
  ɶ: { height: 0, backness: 0, rounded: true },
  ɑ: { height: 0, backness: 1, rounded: false },
  ɒ: { height: 0, backness: 1, rounded: true },
};

const MID: VowelPosition = { height: 0.5, backness: 0.5, rounded: false };

/** Strip length marks and diacritics before looking a vowel up. */
function baseVowel(ipa: string): string {
  return ipa.replace(/[ːˑˈˌ]/gu, '').normalize('NFD').replace(/\p{Mn}/gu, '')[0] ?? '';
}

export function vowelPosition(ipa: string): VowelPosition {
  return VOWEL_SPACE[baseVowel(ipa)] ?? MID;
}

/**
 * The height of the vowel that carries a word.
 *
 * Prefers the primary-stressed vowel, because that is the one a listener hears
 * as the word's centre of gravity. Diphthongs are read from their first
 * element — the target the singer actually sustains before gliding.
 */
export function wordVowelHeight(word: PhoneticWord): number {
  const vowels = word.phones.filter((phone) => phone.isVowel);
  if (vowels.length === 0) return MID.height;

  const stressed =
    vowels.find((phone) => phone.stress === 1) ??
    vowels.find((phone) => phone.stress === 2) ??
    vowels[0]!;

  return vowelPosition(stressed.ipa).height;
}

export function phoneVowelPosition(phone: Phone): VowelPosition | null {
  return phone.isVowel ? vowelPosition(phone.ipa) : null;
}

/**
 * Hue for a vowel, mapped around the quadrilateral.
 *
 * Front vowels take the cool end of the palette and back vowels the warm end,
 * so a lyric acquires a colour temperature that tracks its vowel colour. Used
 * for the glyph tinting in the inspector.
 */
export function vowelHue(ipa: string): number {
  const position = vowelPosition(ipa);
  // 165° (aurora mint) → 285° (violet) across the front–back axis.
  return 165 + position.backness * 120;
}
