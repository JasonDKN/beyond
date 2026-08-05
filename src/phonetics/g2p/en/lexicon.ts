/**
 * CMU pronouncing dictionary access.
 *
 * The dictionary is ~135k entries and about 3 MB parsed, so it is imported
 * dynamically and lives in its own bundle chunk. Nothing loads it until the
 * first English word needs a pronunciation.
 */

type Dictionary = Record<string, string>;

let dictionary: Dictionary | null = null;
let loading: Promise<void> | null = null;

export async function loadLexicon(): Promise<void> {
  if (dictionary) return;
  loading ??= import('cmu-pronouncing-dictionary').then((module) => {
    dictionary = module.dictionary as Dictionary;
  });
  await loading;
}

export function isLexiconLoaded(): boolean {
  return dictionary !== null;
}

export function lexiconSize(): number {
  return dictionary ? Object.keys(dictionary).length : 0;
}

/**
 * All pronunciations for a word, best-first.
 *
 * CMUdict stores alternates under parenthesised keys — `read`, `read(2)` —
 * which is exactly what a singer wants offered when the default sounds wrong.
 */
export function lookup(word: string): string[] {
  if (!dictionary) return [];
  const primary = dictionary[word];
  if (primary === undefined) return [];
  const results = [primary];
  for (let n = 2; n <= 5; n += 1) {
    const alternate = dictionary[`${word}(${n})`];
    if (alternate === undefined) break;
    results.push(alternate);
  }
  return results;
}

export function has(word: string): boolean {
  return dictionary !== null && dictionary[word] !== undefined;
}

/**
 * Regular inflections that CMUdict may not list for rarer stems.
 *
 * Each rule strips a suffix, looks the stem up, and re-attaches the phones the
 * suffix contributes. `-s` and `-ed` are allomorphic — their realisation
 * depends on the final phone of the stem — so those are computed rather than
 * fixed. This rescues a surprising number of words in lyrics, which love
 * inventing participles.
 */
interface InflectionRule {
  readonly suffix: string;
  /** How to rebuild candidate stems from the surface form. */
  readonly stems: (base: string) => string[];
  /** Phones the suffix adds, given the stem's pronunciation. */
  readonly attach: (stemPhones: string[]) => string[] | null;
}

const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH', 'HH', 'CH']);
const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const ALVEOLAR_STOP = new Set(['T', 'D']);

function bare(symbol: string): string {
  return symbol.replace(/[012]$/, '');
}

const INFLECTIONS: readonly InflectionRule[] = [
  {
    suffix: 's',
    stems: (base) => [base, `${base}e`],
    attach: (phones) => {
      const last = bare(phones.at(-1) ?? '');
      if (SIBILANT.has(last)) return ['IH0', 'Z'];
      return VOICELESS.has(last) ? ['S'] : ['Z'];
    },
  },
  {
    suffix: 'es',
    stems: (base) => [base, base.replace(/i$/, 'y')],
    attach: (phones) => {
      const last = bare(phones.at(-1) ?? '');
      if (SIBILANT.has(last)) return ['IH0', 'Z'];
      return VOICELESS.has(last) ? ['S'] : ['Z'];
    },
  },
  {
    suffix: 'ed',
    stems: (base) => [base, `${base}e`, base.replace(/(.)\1$/, '$1'), base.replace(/i$/, 'y')],
    attach: (phones) => {
      const last = bare(phones.at(-1) ?? '');
      if (ALVEOLAR_STOP.has(last)) return ['IH0', 'D'];
      return VOICELESS.has(last) ? ['T'] : ['D'];
    },
  },
  {
    suffix: 'ing',
    stems: (base) => [base, `${base}e`, base.replace(/(.)\1$/, '$1')],
    attach: () => ['IH0', 'NG'],
  },
  {
    suffix: "'s",
    stems: (base) => [base],
    attach: (phones) => {
      const last = bare(phones.at(-1) ?? '');
      if (SIBILANT.has(last)) return ['IH0', 'Z'];
      return VOICELESS.has(last) ? ['S'] : ['Z'];
    },
  },
  {
    suffix: 'ly',
    stems: (base) => [base, `${base}e`, base.replace(/i$/, 'y')],
    attach: () => ['L', 'IY0'],
  },
];

/**
 * Try to build a pronunciation for an unlisted inflected form.
 * Returns an ARPAbet string, or null if no rule applies.
 */
export function lookupInflected(word: string): string | null {
  if (!dictionary) return null;
  for (const rule of INFLECTIONS) {
    if (!word.endsWith(rule.suffix)) continue;
    const base = word.slice(0, word.length - rule.suffix.length);
    if (base.length < 2) continue;
    for (const stem of rule.stems(base)) {
      const [pronunciation] = lookup(stem);
      if (!pronunciation) continue;
      const phones = pronunciation.split(' ');
      const added = rule.attach(phones);
      if (!added) continue;
      return [...phones, ...added].join(' ');
    }
  }
  return null;
}
