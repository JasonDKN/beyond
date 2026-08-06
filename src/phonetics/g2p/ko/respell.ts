import type { Syllable } from '@/core/types';

/**
 * A learner's respelling, derived from the IPA rather than from the spelling.
 *
 * IPA is the correct answer and a terrible first answer. Someone who wants to
 * sing along tonight needs something they can read at speed, in the alphabet
 * they already have — and crucially it must be built from the *pronounced*
 * form, after the sound rules have run, or it reproduces exactly the mistake
 * that lyric-site romanizations make.
 *
 * So this is deliberately not Revised Romanization. RR is a transliteration
 * system designed for road signs and passports; it answers "how is this
 * spelled in Latin letters". This answers "what noise do I make", which is a
 * different question with a different answer.
 *
 *   좋아요   RR: joh-a-yo        here: jo-ah-yo
 *   신라     RR: sinra           here: shil-la
 *   학교     RR: hakgyo          here: hahk-kkyo
 */

const CONSONANTS: Readonly<Record<string, string>> = {
  // Lax
  k: 'g',
  ɡ: 'g',
  t: 'd',
  d: 'd',
  p: 'b',
  b: 'b',
  tɕ: 'j',
  dʑ: 'j',
  s: 's',
  ɕ: 'sh',
  h: 'h',
  ɦ: 'h',
  // Tense — doubled, which is how English readers instinctively read them
  'k͈': 'kk',
  't͈': 'tt',
  'p͈': 'pp',
  's͈': 'ss',
  'ɕ͈': 'ssh',
  't͈ɕ': 'jj',
  // Aspirated
  kʰ: 'k',
  tʰ: 't',
  pʰ: 'p',
  tɕʰ: 'ch',
  // Sonorants
  n: 'n',
  m: 'm',
  ŋ: 'ng',
  l: 'l',
  ɾ: 'r',
  // Glides
  j: 'y',
  w: 'w',
  ɰ: '',
};

/** Unreleased final stops. Written as their plain letter — the hold is audible
 * but no English speaker needs a diacritic to produce it at the end of a word. */
const FINAL_CONSONANTS: Readonly<Record<string, string>> = {
  'k̚': 'k',
  't̚': 't',
  'p̚': 'p',
  k: 'k',
  t: 't',
  p: 'p',
  n: 'n',
  m: 'm',
  ŋ: 'ng',
  l: 'l',
};

/**
 * Vowels, spelled the way an English reader will actually pronounce them.
 * `ʌ` is the hard one: Korean 어 is not English "eo" and not "oh"; "uh" gets
 * an English speaker far closer than either.
 */
const VOWELS: Readonly<Record<string, string>> = {
  a: 'ah',
  ʌ: 'uh',
  // Plain `o`, not `oh`: an English reader already says an open-syllable o as
  // the right sound, and `oh` on every o-syllable makes a line unreadable.
  o: 'o',
  u: 'oo',
  ɯ: 'eu',
  i: 'ee',
  e: 'eh',
  ɛ: 'eh',
};

/**
 * Drop length and unrelease marks before looking a symbol up. Written as an
 * alternation rather than a character class because `̚` is a combining mark,
 * which a class would silently mis-handle.
 */
function stripDiacritics(ipa: string): string {
  return ipa.replace(/ː|̚/gu, '');
}

/** Respell one syllable. */
function respellSyllable(syllable: Syllable): string {
  const onset = syllable.onset
    .map((phone) => CONSONANTS[phone.ipa] ?? CONSONANTS[stripDiacritics(phone.ipa)] ?? phone.ipa)
    .join('');

  const nucleus = syllable.nucleus
    .map((phone) => VOWELS[stripDiacritics(phone.ipa)] ?? phone.ipa)
    .join('');

  const coda = syllable.coda
    .map((phone) => FINAL_CONSONANTS[phone.ipa] ?? FINAL_CONSONANTS[stripDiacritics(phone.ipa)] ?? phone.ipa)
    .join('');

  return onset + nucleus + coda;
}

/**
 * Respell a word, hyphenating between syllables.
 *
 * The hyphens are not decoration. Korean is syllable-timed — every block gets
 * an equal beat — so seeing the syllable count is most of what you need to rap
 * a line in time. English speakers instinctively compress unstressed syllables,
 * and that instinct is the main thing to unlearn.
 */
export function respell(syllables: readonly Syllable[]): string {
  return syllables.map(respellSyllable).join('-');
}
