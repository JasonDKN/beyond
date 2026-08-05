import type { Phone } from '@/core/types';
import { arpabetToPhones } from '@/phonetics/arpabet';
import type { G2PEngine, Pronunciation } from '../engine';
import { has, loadLexicon, lookup, lookupInflected } from './lexicon';
import { pronounceByRule } from './rules';

/**
 * English G2P: dictionary first, rules second.
 *
 * The order matters more than either piece. CMUdict knows that `read` has two
 * pronunciations and that `colonel` sounds nothing like it looks — no rule set
 * will ever get those. The rules exist only for what the dictionary has never
 * heard of, which in a lyric sheet is mostly names and vocalisations.
 */

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

const TENS = [
  '',
  'ten',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

/** Spell a small integer so it can go through the lexicon like any other word. */
function numberToWords(value: number): string[] {
  if (value === 0) return ['zero'];
  if (value >= 1000) {
    // Years and large numbers: read them digit-pair-wise rather than inventing
    // a full cardinal expander. "1984" → nineteen eighty four.
    return String(value)
      .split('')
      .map((digit) => NUMBER_WORDS[digit] ?? digit);
  }
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  let rest = value % 100;
  if (hundreds > 0) words.push(ONES[hundreds]!, 'hundred');
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]!);
    rest = 0;
  } else if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]!);
    rest %= 10;
  }
  if (rest > 0) words.push(ONES[rest]!);
  return words;
}

/**
 * Undo sung vowel elongation: `sooooo` → `so`, `feeel` → `feel`.
 *
 * ASR output of singing is full of these, and the collapse is ambiguous:
 * `feeel` wants two letters back, `sooooo` wants one, and both `soo` and `fel`
 * happen to be real dictionary entries, so trying one order first is wrong half
 * the time.
 *
 * The tie-breaker is run length. English orthography does double letters, so a
 * run of three is usually an already-doubled spelling with one extra
 * (`feel` → `feeel`); a run of four or more is someone holding a short word on
 * a note (`so` → `sooooo`). Whichever candidate loses is still offered as a
 * variant in the inspector rather than thrown away.
 */
function elongationCandidates(word: string): string[] {
  const longestRun = [...word.matchAll(/(.)\1+/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0,
  );
  if (longestRun < 3) return [];

  const doubled = word.replace(/(.)\1{2,}/g, '$1$1');
  const single = word.replace(/(.)\1{2,}/g, '$1');
  const ordered = longestRun >= 4 ? [single, doubled] : [doubled, single];
  return ordered.filter((candidate, index, all) => candidate !== word && all.indexOf(candidate) === index);
}

function fromArpabet(
  arpabet: string,
  source: Pronunciation['source'],
  confidence: number,
  variants?: readonly string[],
): Pronunciation {
  const base: Pronunciation = { phones: arpabetToPhones(arpabet), source, confidence };
  return variants && variants.length > 0 ? { ...base, variants } : base;
}

class EnglishG2P implements G2PEngine {
  readonly id = 'en-cmudict';
  readonly label = 'English — CMU dictionary + letter-to-sound rules';
  readonly languages = ['en'] as const;
  readonly quality = 'lexicon' as const;

  async load(): Promise<void> {
    await loadLexicon();
  }

  pronounce(word: string): Pronunciation {
    if (!word) return { phones: [], source: 'rules', confidence: 0 };

    // 1. Straight dictionary hit, with any alternates offered as variants.
    const direct = lookup(word);
    if (direct.length > 0) {
      const [best, ...rest] = direct as [string, ...string[]];
      return fromArpabet(
        best,
        'lexicon',
        1,
        rest.map((alt) => arpabetToPhones(alt).map((p) => p.ipa).join('')),
      );
    }

    // 2. Digits — spell them out and pronounce the words.
    if (/^\d+$/.test(word)) {
      const phones = numberToWords(Number(word)).flatMap<Phone>(
        (spelled) => this.pronounce(spelled).phones as Phone[],
      );
      return { phones, source: 'lexicon', confidence: 0.9 };
    }

    // 3. Hyphenated or apostrophised compounds — pronounce each part.
    if (word.includes('-') && word.length > 2) {
      const parts = word.split('-').filter(Boolean);
      if (parts.length > 1 && parts.every((part) => has(part))) {
        const phones = parts.flatMap<Phone>((part) => this.pronounce(part).phones as Phone[]);
        return { phones, source: 'lexicon', confidence: 0.95 };
      }
    }

    // 4. Regular inflection built from a listed stem.
    const inflected = lookupInflected(word);
    if (inflected) return fromArpabet(inflected, 'lexicon-inflected', 0.85);

    // 5. Sung elongation — collapse the vowel run and try again.
    const collapses = elongationCandidates(word)
      .map((candidate) => lookup(candidate)[0])
      .filter((hit): hit is string => hit !== undefined);
    if (collapses.length > 0) {
      const [best, ...rest] = collapses as [string, ...string[]];
      return fromArpabet(
        best,
        'lexicon-inflected',
        0.8,
        rest.map((alt) => arpabetToPhones(alt).map((p) => p.ipa).join('')),
      );
    }

    // 6. Letter-to-sound rules. Confidence drops with length, because every
    //    additional grapheme is another chance for the rules to be wrong.
    const guessed = pronounceByRule(word);
    const confidence = Math.max(0.35, 0.75 - word.length * 0.02);
    return fromArpabet(guessed, 'rules', confidence);
  }
}

export const englishG2P: G2PEngine = new EnglishG2P();
