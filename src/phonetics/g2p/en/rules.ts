/**
 * Rule-based English grapheme-to-phoneme, used when the lexicon has no entry.
 *
 * Lyrics are full of words no dictionary contains: proper nouns, coinages,
 * "ooooh", brand names, deliberate misspellings. Rather than give up on those,
 * we fall back to a context-sensitive letter-to-sound rule set in the spirit of
 * the NRL rules — each rule matches a grapheme plus optional left/right
 * context, longest and most specific first, scanning left to right.
 *
 * It is not as good as a dictionary and it does not pretend to be: everything
 * produced here is marked `source: 'rules'` with reduced confidence so the UI
 * can show it as provisional.
 */

interface Rule {
  /** Letters consumed by this rule. */
  readonly g: string;
  /** Must match the end of the text already consumed (word padded with `#`). */
  readonly left?: RegExp;
  /** Must match the start of the text still to come (word padded with `#`). */
  readonly right?: RegExp;
  /** ARPAbet symbols produced, stressless. Empty for silent letters. */
  readonly phones: readonly string[];
}

/** Consonant letter, or the word boundary. */
const C = '[bcdfghjklmnpqrstvwxyz]';
/** "Magic e": one consonant then a final `e`, as in cake / bite / hope. */
const MAGIC_E = new RegExp(`^${C}e#$`);
const FRONT = /^[eiy]/;

const RULES: readonly Rule[] = [
  // --- Multi-letter suffixes -------------------------------------------------
  { g: 'tion', phones: ['SH', 'AH', 'N'] },
  { g: 'sion', left: /[aeiou]$/, phones: ['ZH', 'AH', 'N'] },
  { g: 'sion', phones: ['SH', 'AH', 'N'] },
  { g: 'cious', phones: ['SH', 'AH', 'S'] },
  { g: 'tious', phones: ['SH', 'AH', 'S'] },
  { g: 'ture', right: /^#/, phones: ['CH', 'ER'] },
  { g: 'sure', right: /^#/, phones: ['ZH', 'ER'] },
  { g: 'ough', phones: ['AO'] },
  { g: 'augh', phones: ['AE', 'F'] },
  { g: 'igh', phones: ['AY'] },
  { g: 'eigh', phones: ['EY'] },
  { g: 'dge', phones: ['JH'] },
  { g: 'tch', phones: ['CH'] },
  { g: 'sch', phones: ['S', 'K'] },

  // --- R-coloured vowels (before plain vowel digraphs, which they contain) ---
  { g: 'eer', phones: ['IH', 'R'] },
  { g: 'ear', right: /^#/, phones: ['IH', 'R'] },
  { g: 'air', phones: ['EH', 'R'] },
  { g: 'are', right: /^#/, phones: ['EH', 'R'] },
  { g: 'our', phones: ['AW', 'ER'] },
  { g: 'ar', phones: ['AA', 'R'] },
  { g: 'or', phones: ['AO', 'R'] },
  { g: 'er', phones: ['ER'] },
  { g: 'ir', phones: ['ER'] },
  { g: 'ur', phones: ['ER'] },
  { g: 'yr', phones: ['ER'] },

  // --- Vowel digraphs --------------------------------------------------------
  { g: 'ee', phones: ['IY'] },
  { g: 'ea', phones: ['IY'] },
  { g: 'ei', phones: ['IY'] },
  { g: 'ie', right: /^#/, phones: ['IY'] },
  { g: 'ie', phones: ['IY'] },
  { g: 'oo', phones: ['UW'] },
  { g: 'oa', phones: ['OW'] },
  { g: 'oe', phones: ['OW'] },
  { g: 'ou', phones: ['AW'] },
  { g: 'ow', right: /^#/, phones: ['OW'] },
  { g: 'ow', phones: ['AW'] },
  { g: 'oi', phones: ['OY'] },
  { g: 'oy', phones: ['OY'] },
  { g: 'au', phones: ['AO'] },
  { g: 'aw', phones: ['AO'] },
  { g: 'ai', phones: ['EY'] },
  { g: 'ay', phones: ['EY'] },
  { g: 'ue', phones: ['UW'] },
  { g: 'ui', phones: ['UW'] },
  { g: 'eu', phones: ['UW'] },
  { g: 'ew', phones: ['UW'] },

  // --- Consonant digraphs ----------------------------------------------------
  { g: 'ch', phones: ['CH'] },
  { g: 'sh', phones: ['SH'] },
  { g: 'th', phones: ['TH'] },
  { g: 'ph', phones: ['F'] },
  { g: 'wh', phones: ['W'] },
  { g: 'gh', left: /#$/, phones: ['G'] },
  { g: 'gh', phones: [] }, // night, through — silent after a vowel
  { g: 'ck', phones: ['K'] },
  { g: 'nk', phones: ['NG', 'K'] },
  { g: 'ng', right: /^#/, phones: ['NG'] },
  { g: 'ng', phones: ['NG'] },
  { g: 'qu', phones: ['K', 'W'] },
  { g: 'wr', left: /#$/, phones: ['R'] },
  { g: 'kn', left: /#$/, phones: ['N'] },
  { g: 'gn', left: /#$/, phones: ['N'] },
  { g: 'gn', right: /^#/, phones: ['N'] },
  { g: 'mb', right: /^#/, phones: ['M'] },
  { g: 'mn', right: /^#/, phones: ['M'] },
  { g: 'ps', left: /#$/, phones: ['S'] },
  { g: 'ce', right: /^#/, phones: ['S'] },
  { g: 'ge', right: /^#/, phones: ['JH'] },
  { g: 'le', left: new RegExp(`${C}$`), right: /^#/, phones: ['AH', 'L'] },

  // --- Single vowels ---------------------------------------------------------
  { g: 'a', right: MAGIC_E, phones: ['EY'] },
  { g: 'a', right: /^#/, phones: ['AH'] },
  { g: 'a', phones: ['AE'] },
  { g: 'e', left: /[aeiou].*$/, right: /^#/, phones: [] }, // silent final e
  { g: 'e', right: MAGIC_E, phones: ['IY'] },
  { g: 'e', right: /^#/, phones: ['IY'] },
  { g: 'e', phones: ['EH'] },
  { g: 'i', right: MAGIC_E, phones: ['AY'] },
  { g: 'i', right: /^#/, phones: ['IY'] },
  { g: 'i', right: /^nd#/, phones: ['AY'] },
  { g: 'i', phones: ['IH'] },
  { g: 'o', right: MAGIC_E, phones: ['OW'] },
  { g: 'o', right: /^#/, phones: ['OW'] },
  { g: 'o', right: /^ld#/, phones: ['OW'] },
  { g: 'o', phones: ['AA'] },
  { g: 'u', right: MAGIC_E, phones: ['UW'] },
  { g: 'u', right: /^#/, phones: ['UW'] },
  { g: 'u', phones: ['AH'] },
  { g: 'y', left: /#$/, phones: ['Y'] },
  { g: 'y', right: /^#/, phones: ['IY'] },
  { g: 'y', right: MAGIC_E, phones: ['AY'] },
  { g: 'y', phones: ['IH'] },

  // --- Single consonants -----------------------------------------------------
  { g: 'b', phones: ['B'] },
  { g: 'c', right: FRONT, phones: ['S'] },
  { g: 'c', phones: ['K'] },
  { g: 'd', phones: ['D'] },
  { g: 'f', phones: ['F'] },
  { g: 'g', right: FRONT, phones: ['JH'] },
  { g: 'g', phones: ['G'] },
  { g: 'h', phones: ['HH'] },
  { g: 'j', phones: ['JH'] },
  { g: 'k', phones: ['K'] },
  { g: 'l', phones: ['L'] },
  { g: 'm', phones: ['M'] },
  { g: 'n', phones: ['N'] },
  { g: 'p', phones: ['P'] },
  { g: 'r', phones: ['R'] },
  { g: 's', left: /[aeiourlmn]$/, right: /^#/, phones: ['Z'] },
  { g: 's', phones: ['S'] },
  { g: 't', phones: ['T'] },
  { g: 'v', phones: ['V'] },
  { g: 'w', phones: ['W'] },
  { g: 'x', phones: ['K', 'S'] },
  { g: 'z', phones: ['Z'] },
  { g: "'", phones: [] },
  { g: '-', phones: [] },
  { g: '.', phones: [] },
];

/** Index rules by first letter so lookup is a short scan, not a full sweep. */
const BY_FIRST_LETTER = ((): Map<string, Rule[]> => {
  const map = new Map<string, Rule[]>();
  for (const rule of RULES) {
    const key = rule.g[0]!;
    const bucket = map.get(key);
    if (bucket) bucket.push(rule);
    else map.set(key, [rule]);
  }
  // Longest grapheme first, so `tion` wins over `t`.
  for (const bucket of map.values()) bucket.sort((a, b) => b.g.length - a.g.length);
  return map;
})();

const VOWEL_PHONES = new Set([
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

/** Collapse doubled consonants — `letter` should not give two Ts. */
function degeminate(word: string): string {
  return word.replace(/([bcdfgklmnprstvz])\1/g, '$1');
}

/**
 * Assign stress to a rule-derived pronunciation.
 *
 * A real stress model needs morphology we do not have here, so this uses the
 * two heuristics that get English right most often: monosyllables and
 * disyllables stress the first syllable; longer words stress the antepenult,
 * which is where the Latinate majority of long English words put it.
 */
function assignStress(phones: string[]): string[] {
  const nuclei: number[] = [];
  phones.forEach((phone, index) => {
    if (VOWEL_PHONES.has(phone)) nuclei.push(index);
  });
  if (nuclei.length === 0) return phones;

  const stressedNucleus =
    nuclei.length <= 2 ? nuclei[0]! : (nuclei[nuclei.length - 3] ?? nuclei[0]!);

  return phones.map((phone, index) => {
    if (!VOWEL_PHONES.has(phone)) return phone;
    if (index === stressedNucleus) return `${phone}1`;
    // Unstressed AH is a schwa, which is what English actually does to it.
    return `${phone}0`;
  });
}

/**
 * Apply the rule set to a word. Returns a stressed ARPAbet string.
 * Never throws and never returns empty for a non-empty word — an unrecognised
 * letter is skipped rather than aborting the whole pronunciation.
 */
export function pronounceByRule(word: string): string {
  const text = `#${degeminate(word.toLowerCase())}#`;
  const phones: string[] = [];

  let i = 1; // skip the leading boundary marker
  while (i < text.length - 1) {
    const letter = text[i]!;
    const candidates = BY_FIRST_LETTER.get(letter);
    let matched: Rule | undefined;

    if (candidates) {
      for (const rule of candidates) {
        if (!text.startsWith(rule.g, i)) continue;
        if (rule.left && !rule.left.test(text.slice(0, i))) continue;
        if (rule.right && !rule.right.test(text.slice(i + rule.g.length))) continue;
        matched = rule;
        break;
      }
    }

    if (matched) {
      phones.push(...matched.phones);
      i += matched.g.length;
    } else {
      i += 1; // unknown character (digit, emoji, foreign letter): skip it
    }
  }

  return assignStress(phones).join(' ');
}
