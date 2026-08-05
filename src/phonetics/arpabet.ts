import type { Phone } from '@/core/types';

/**
 * ARPAbet → IPA.
 *
 * The lexicon speaks ARPAbet; the world speaks IPA. This is the bridge.
 * Values follow the General American conventions used by most singing-diction
 * references: rhotic `ɹ`, r-coloured `ɝ/ɚ`, and diphthongs written as full
 * two-symbol sequences rather than the `eː`-style monophthongs some British
 * dictionaries prefer.
 */
export const ARPABET_TO_IPA: Readonly<Record<string, string>> = Object.freeze({
  // Monophthongs
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ', // → 'ə' when unstressed; handled in toPhone()
  AO: 'ɔ',
  EH: 'ɛ',
  ER: 'ɝ', // → 'ɚ' when unstressed
  IH: 'ɪ',
  IY: 'i',
  UH: 'ʊ',
  UW: 'u',
  // Diphthongs
  AW: 'aʊ',
  AY: 'aɪ',
  EY: 'eɪ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  // Stops
  P: 'p',
  B: 'b',
  T: 't',
  D: 'd',
  K: 'k',
  G: 'ɡ', // U+0261 latin small letter script g — the IPA glyph, not ASCII 'g'
  // Affricates
  CH: 'tʃ',
  JH: 'dʒ',
  // Fricatives
  F: 'f',
  V: 'v',
  TH: 'θ',
  DH: 'ð',
  S: 's',
  Z: 'z',
  SH: 'ʃ',
  ZH: 'ʒ',
  HH: 'h',
  // Nasals
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  // Approximants
  L: 'l',
  R: 'ɹ',
  W: 'w',
  Y: 'j',
});

export const IPA_PRIMARY_STRESS = 'ˈ';
export const IPA_SECONDARY_STRESS = 'ˌ';

const VOWEL_SYMBOLS = new Set([
  'AA',
  'AE',
  'AH',
  'AO',
  'AW',
  'AY',
  'EH',
  'ER',
  'EY',
  'IH',
  'IY',
  'OW',
  'OY',
  'UH',
  'UW',
]);

/** True for ARPAbet symbols that carry a syllable nucleus. */
export function isArpabetVowel(symbol: string): boolean {
  return VOWEL_SYMBOLS.has(stripStress(symbol));
}

export function stripStress(symbol: string): string {
  return symbol.replace(/[012]$/, '');
}

export function stressOf(symbol: string): 0 | 1 | 2 {
  const digit = symbol.at(-1);
  return digit === '1' ? 1 : digit === '2' ? 2 : 0;
}

/**
 * Convert one stressed ARPAbet symbol to a Phone.
 *
 * Two reductions happen here rather than in the map, because they depend on
 * stress rather than on the symbol alone:
 *   AH0 → ə   (the schwa; `about`, `sofa`)
 *   ER0 → ɚ   (r-coloured schwa; `butter`, `winner`)
 */
export function toPhone(symbol: string): Phone {
  const base = stripStress(symbol);
  const stress = stressOf(symbol);
  const isVowel = VOWEL_SYMBOLS.has(base);

  let ipa = ARPABET_TO_IPA[base] ?? base.toLowerCase();
  if (base === 'AH' && stress === 0) ipa = 'ə';
  if (base === 'ER' && stress === 0) ipa = 'ɚ';

  return isVowel
    ? { ipa, native: symbol, isVowel: true, stress }
    : { ipa, native: symbol, isVowel: false };
}

/** Convert a full ARPAbet pronunciation string (`"HH AH0 L OW1"`) to phones. */
export function arpabetToPhones(pronunciation: string): Phone[] {
  return pronunciation
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((symbol) => toPhone(symbol.toUpperCase()));
}
