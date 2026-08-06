import type { Phone, Syllable } from '@/core/types';
import type { Jamo } from './jamo';

/**
 * Korean jamo → IPA, with the allophony that actually matters to a singer.
 *
 * Korean's consonants come in threes — lax, tense, aspirated — a contrast
 * English does not have and English speakers reliably flatten. ㄱ/ㄲ/ㅋ are
 * three different consonants, not one consonant said three ways, and writing
 * them all as "k" is how a romanization loses the word.
 *
 * Two context effects are applied here rather than in the rules file, because
 * they are surface detail rather than phonology proper:
 *
 *   Voicing   — lax stops voice between voiced sounds. 한국 is [hanɡuk̚], not
 *               [hankuk̚]: the ㄱ voices because a vowel and a nasal surround it.
 *   Unrelease — a final stop is held, not released. That is the `̚` diacritic,
 *               and it is why 밥 does not rhyme with English "bop".
 */

export interface KoreanIpaOptions {
  /**
   * Merge ㅐ and ㅔ to [e]. Contemporary Seoul speech merged these decades ago,
   * so this is on by default — it is what a K-pop vocalist actually sings.
   * Turn it off to see the older, still-taught distinction.
   */
  readonly mergeAeE: boolean;
  /** Mark unreleased final stops with `̚`. Accurate, but visually busy. */
  readonly markUnreleased: boolean;
  /** Voice lax obstruents between voiced sounds. Almost always wanted. */
  readonly intervocalicVoicing: boolean;
}

export const DEFAULT_KOREAN_IPA: KoreanIpaOptions = {
  mergeAeE: true,
  markUnreleased: true,
  intervocalicVoicing: true,
};

/** Onset consonants, in their default (voiceless) realization. */
const ONSET_IPA: Readonly<Record<string, string>> = {
  ㄱ: 'k',
  ㄲ: 'k͈',
  ㅋ: 'kʰ',
  ㄷ: 't',
  ㄸ: 't͈',
  ㅌ: 'tʰ',
  ㅂ: 'p',
  ㅃ: 'p͈',
  ㅍ: 'pʰ',
  ㅅ: 's',
  ㅆ: 's͈',
  ㅈ: 'tɕ',
  ㅉ: 't͈ɕ',
  ㅊ: 'tɕʰ',
  ㅎ: 'h',
  ㄴ: 'n',
  ㅁ: 'm',
  ㄹ: 'ɾ',
  ㅇ: '', // silent in onset position — it is a placeholder, not a sound
};

/** Voiced counterparts of the lax obstruents. */
const VOICED: Readonly<Record<string, string>> = {
  k: 'ɡ',
  t: 'd',
  p: 'b',
  tɕ: 'dʑ',
  h: 'ɦ',
};

/** Palatalized forms used before /i/ and /j/. 시 is [ɕi], never [si]. */
const PALATALIZED: Readonly<Record<string, string>> = {
  s: 'ɕ',
  's͈': 'ɕ͈',
};

const CODA_IPA: Readonly<Record<string, string>> = {
  ㄱ: 'k',
  ㄴ: 'n',
  ㄷ: 't',
  ㄹ: 'l',
  ㅁ: 'm',
  ㅂ: 'p',
  ㅇ: 'ŋ',
};

const UNRELEASED = new Set(['k', 't', 'p']);

/** Vowels, as an optional on-glide plus a nucleus. */
const VOWEL_IPA: Readonly<Record<string, readonly [glide: string, nucleus: string]>> = {
  ㅏ: ['', 'a'],
  ㅐ: ['', 'ɛ'],
  ㅑ: ['j', 'a'],
  ㅒ: ['j', 'ɛ'],
  ㅓ: ['', 'ʌ'],
  ㅔ: ['', 'e'],
  ㅕ: ['j', 'ʌ'],
  ㅖ: ['j', 'e'],
  ㅗ: ['', 'o'],
  ㅘ: ['w', 'a'],
  ㅙ: ['w', 'ɛ'],
  ㅚ: ['w', 'e'],
  ㅛ: ['j', 'o'],
  ㅜ: ['', 'u'],
  ㅝ: ['w', 'ʌ'],
  ㅞ: ['w', 'e'],
  ㅟ: ['w', 'i'],
  ㅠ: ['j', 'u'],
  ㅡ: ['', 'ɯ'],
  ㅢ: ['ɰ', 'i'],
  ㅣ: ['', 'i'],
};

const SONORANT_CODAS = new Set(['n', 'm', 'ŋ', 'l']);

function consonant(ipa: string): Phone {
  return { ipa, isVowel: false };
}

/**
 * Convert phonology-processed syllables to IPA syllables.
 *
 * Korean needs no sonority-based syllabifier: the writing system already
 * declares the syllable boundaries, and after the rules have run those
 * boundaries are the spoken ones. That is a real advantage over English, where
 * syllabification has to be inferred.
 */
export function toIpaSyllables(
  syllables: readonly Jamo[],
  options: KoreanIpaOptions = DEFAULT_KOREAN_IPA,
): Syllable[] {
  return syllables.map((jamo, index) => {
    const previous = syllables[index - 1];
    const [glide, rawNucleus] = VOWEL_IPA[jamo.nucleus] ?? ['', 'a'];

    let nucleusIpa = rawNucleus;
    if (options.mergeAeE && nucleusIpa === 'ɛ') nucleusIpa = 'e';

    // --- Onset ---------------------------------------------------------
    const onset: Phone[] = [];
    let onsetIpa = ONSET_IPA[jamo.onset] ?? '';

    if (onsetIpa) {
      // ㄹ is a tap between vowels but a lateral when it doubles: 실라 is
      // [ɕil.la], two Ls, not [ɕil.ɾa].
      if (jamo.onset === 'ㄹ' && previous?.coda === 'ㄹ') onsetIpa = 'l';

      // Palatalization before a front high vowel or a j-glide.
      if (nucleusIpa === 'i' || glide === 'j') {
        onsetIpa = PALATALIZED[onsetIpa] ?? onsetIpa;
      }

      // Voicing: a lax obstruent between two voiced sounds is voiced. The
      // left context is the previous syllable's coda (or its vowel, if it had
      // no coda); the right context is always this syllable's own vowel.
      if (options.intervocalicVoicing && previous) {
        const previousCoda = previous.coda ? (CODA_IPA[previous.coda] ?? '') : '';
        const leftIsVoiced = previousCoda === '' || SONORANT_CODAS.has(previousCoda);
        if (leftIsVoiced && VOICED[onsetIpa]) onsetIpa = VOICED[onsetIpa]!;
      }

      onset.push(consonant(onsetIpa));
    }

    if (glide) onset.push(consonant(glide));

    // --- Nucleus -------------------------------------------------------
    // Korean has no lexical stress; every syllable carries equal weight, which
    // is exactly why the language is so well suited to rap. Marking stress
    // would be inventing information, so every nucleus is stress 0.
    const nucleus: Phone[] = [{ ipa: nucleusIpa, isVowel: true, stress: 0 }];

    // --- Coda ----------------------------------------------------------
    const coda: Phone[] = [];
    if (jamo.coda) {
      let codaIpa = CODA_IPA[jamo.coda] ?? '';
      if (codaIpa) {
        if (options.markUnreleased && UNRELEASED.has(codaIpa)) codaIpa += '̚';
        coda.push(consonant(codaIpa));
      }
    }

    return { onset, nucleus, coda, stress: 0 };
  });
}

/** Flatten IPA syllables to a plain string, one dot per syllable boundary. */
export function ipaString(syllables: readonly Syllable[], separator = '.'): string {
  return syllables
    .map((syllable) =>
      [...syllable.onset, ...syllable.nucleus, ...syllable.coda].map((p) => p.ipa).join(''),
    )
    .join(separator);
}
