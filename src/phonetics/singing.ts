import type { Phone } from '@/core/types';

/**
 * Lyric diction adjustments.
 *
 * Speech transcription and singing transcription are not the same document. A
 * classical diction coach will tell you that sung vowels are held pure and long
 * while consonants are pushed late, and that the reduced vowels of speech open
 * back up when they land on a sustained note. None of that is in a pronouncing
 * dictionary, which describes the spoken word.
 *
 * These adjustments are applied last, after the lexicon has had its say, and
 * every one of them can be switched off — a linguist wants the citation form, a
 * singer wants the sung form.
 */

export interface SingingOptions {
  /** Apply any singing adjustments at all. */
  readonly enabled: boolean;
  /** A vowel held longer than this (seconds) is marked long with `ː`. */
  readonly sustainThresholdSec: number;
  /** Open reduced schwas back to full vowels when they are sustained. */
  readonly restoreSustainedSchwa: boolean;
  /** Mark a final consonant that runs into the next word's vowel with `‿`. */
  readonly markLiaison: boolean;
}

export const DEFAULT_SINGING_OPTIONS: SingingOptions = {
  enabled: true,
  sustainThresholdSec: 0.45,
  restoreSustainedSchwa: true,
  markLiaison: false,
};

export const LENGTH_MARK = 'ː';
export const LIAISON_MARK = '‿';

/**
 * What a reduced vowel opens into when it lands on a long note. Singers do
 * this instinctively: a schwa cannot be sustained without acquiring a colour,
 * and the conventional choice in English diction is the open central [ɐ]/[ʌ].
 */
const SCHWA_RESTORATION: Readonly<Record<string, string>> = {
  ə: 'ʌ',
  ɚ: 'ɝ',
  ɪ: 'i',
  ʊ: 'u',
};

/**
 * Distribute a word's duration across its phones, then apply sung adjustments.
 *
 * Duration is split with a simple weighting rather than by forced alignment:
 * vowels carry the note, consonants are transient. It is an approximation, but
 * it is a defensible one, and it is what lets the staff illuminate the right
 * glyph at the right moment without a full aligner.
 */
export function distributeDurations(
  phones: readonly Phone[],
  startSec: number,
  endSec: number,
): Phone[] {
  if (phones.length === 0) return [];
  const total = Math.max(0, endSec - startSec);

  // Weights: a stressed vowel gets the lion's share, an unstressed vowel less,
  // a consonant a fixed small slice.
  const weights = phones.map((phone) => {
    if (!phone.isVowel) return 1;
    return phone.stress === 1 ? 5 : phone.stress === 2 ? 3.5 : 2.5;
  });
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  let cursor = startSec;
  return phones.map((phone, index) => {
    const span = (total * weights[index]!) / weightSum;
    const phoneStart = cursor;
    cursor += span;
    return { ...phone, startSec: phoneStart, endSec: cursor };
  });
}

/** Apply sung-vowel treatment to phones that already carry timings. */
export function applySingingStyle(
  phones: readonly Phone[],
  options: SingingOptions = DEFAULT_SINGING_OPTIONS,
): Phone[] {
  if (!options.enabled) return [...phones];

  return phones.map((phone) => {
    if (!phone.isVowel) return phone;
    const duration =
      phone.endSec !== undefined && phone.startSec !== undefined
        ? phone.endSec - phone.startSec
        : 0;
    if (duration < options.sustainThresholdSec) return phone;

    let ipa = phone.ipa;
    if (options.restoreSustainedSchwa) {
      ipa = SCHWA_RESTORATION[ipa] ?? ipa;
    }
    if (!ipa.endsWith(LENGTH_MARK)) ipa += LENGTH_MARK;
    return { ...phone, ipa };
  });
}

/**
 * Does this word's final consonant carry over to the next word's initial vowel?
 * Purely informational — used to draw the tie mark between words on the staff.
 */
export function hasLiaison(current: readonly Phone[], next: readonly Phone[]): boolean {
  const last = current.at(-1);
  const first = next[0];
  return Boolean(last && first && !last.isVowel && first.isVowel);
}
