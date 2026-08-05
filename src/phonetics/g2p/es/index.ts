import type { Phone } from '@/core/types';
import type { G2PEngine, Pronunciation } from '../engine';

/**
 * Spanish G2P — proof that the engine interface is real.
 *
 * Spanish orthography is close to phonemic, so this needs no dictionary at all:
 * a couple of dozen rules plus the standard stress algorithm gets you most of
 * the way. It exists here mostly to demonstrate that adding a language means
 * writing one file and registering it — no changes anywhere upstream or down.
 *
 * Dialect note: `seseo` (Latin American) merges /θ/ into /s/; Castilian keeps
 * them apart. `yeísmo` merges `ll` and `y`. Both are switchable.
 */

interface SpanishOptions {
  readonly seseo: boolean;
  readonly yeismo: boolean;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü']);
const ACCENTED: Readonly<Record<string, string>> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
};

const VOWEL_IPA: Readonly<Record<string, string>> = {
  a: 'a',
  e: 'e',
  i: 'i',
  o: 'o',
  u: 'u',
};

function vowel(ipa: string, stress: 0 | 1): Phone {
  return { ipa, isVowel: true, stress };
}

function consonant(ipa: string): Phone {
  return { ipa, isVowel: false };
}

class SpanishG2P implements G2PEngine {
  readonly id = 'es-rules';
  readonly label = 'Spanish — orthographic rules';
  readonly languages = ['es'] as const;
  readonly quality = 'rules' as const;

  readonly #options: SpanishOptions;

  constructor(options: SpanishOptions) {
    this.#options = options;
  }

  async load(): Promise<void> {
    /* No assets to load — the rules are the engine. */
  }

  pronounce(word: string): Pronunciation {
    const text = word.toLowerCase().normalize('NFC');
    if (!text) return { phones: [], source: 'rules', confidence: 0 };

    const stressIndex = this.#stressedVowelIndex(text);
    const phones: Phone[] = [];

    let i = 0;
    while (i < text.length) {
      const ch = text[i]!;
      const next = text[i + 1];
      const atStart = i === 0;
      const previous = text[i - 1];

      // --- Digraphs ---------------------------------------------------------
      if (ch === 'c' && next === 'h') {
        phones.push(consonant('tʃ'));
        i += 2;
        continue;
      }
      if (ch === 'l' && next === 'l') {
        phones.push(consonant(this.#options.yeismo ? 'ʝ' : 'ʎ'));
        i += 2;
        continue;
      }
      if (ch === 'r' && next === 'r') {
        phones.push(consonant('r'));
        i += 2;
        continue;
      }
      if (ch === 'q' && next === 'u') {
        phones.push(consonant('k'));
        i += 2; // the u is always silent in que/qui
        continue;
      }
      if (ch === 'g' && next === 'u' && (text[i + 2] === 'e' || text[i + 2] === 'i')) {
        phones.push(consonant('ɡ'));
        i += 2;
        continue;
      }

      // --- Vowels -----------------------------------------------------------
      if (VOWELS.has(ch)) {
        const base = ACCENTED[ch] ?? ch;
        // A silent u only appears after q/g, both handled above.
        phones.push(vowel(VOWEL_IPA[base] ?? base, i === stressIndex ? 1 : 0));
        i += 1;
        continue;
      }

      // --- Single consonants -------------------------------------------------
      switch (ch) {
        case 'b':
        case 'v':
          phones.push(consonant('b'));
          break;
        case 'c':
          phones.push(
            consonant(
              next === 'e' || next === 'i' ? (this.#options.seseo ? 's' : 'θ') : 'k',
            ),
          );
          break;
        case 'd':
          phones.push(consonant('d'));
          break;
        case 'f':
          phones.push(consonant('f'));
          break;
        case 'g':
          phones.push(consonant(next === 'e' || next === 'i' ? 'x' : 'ɡ'));
          break;
        case 'h':
          break; // always silent
        case 'j':
          phones.push(consonant('x'));
          break;
        case 'k':
          phones.push(consonant('k'));
          break;
        case 'l':
          phones.push(consonant('l'));
          break;
        case 'm':
          phones.push(consonant('m'));
          break;
        case 'n':
          phones.push(consonant('n'));
          break;
        case 'ñ':
          phones.push(consonant('ɲ'));
          break;
        case 'p':
          phones.push(consonant('p'));
          break;
        case 'r':
          // Word-initial r, or r after n/l/s, is a trill; elsewhere a tap.
          phones.push(
            consonant(atStart || previous === 'n' || previous === 'l' || previous === 's' ? 'r' : 'ɾ'),
          );
          break;
        case 's':
          phones.push(consonant('s'));
          break;
        case 't':
          phones.push(consonant('t'));
          break;
        case 'w':
          phones.push(consonant('w'));
          break;
        case 'x':
          phones.push(consonant('k'), consonant('s'));
          break;
        case 'y':
          if (next === undefined || !VOWELS.has(next)) phones.push(vowel('i', 0));
          else phones.push(consonant(this.#options.yeismo ? 'ʝ' : 'ʝ'));
          break;
        case 'z':
          phones.push(consonant(this.#options.seseo ? 's' : 'θ'));
          break;
        default:
          break; // punctuation, digits, anything unexpected
      }
      i += 1;
    }

    return { phones, source: 'rules', confidence: 0.9 };
  }

  /**
   * Standard Spanish stress: a written accent wins; otherwise words ending in a
   * vowel, `n`, or `s` are stressed on the penultimate syllable, and everything
   * else on the last. Implemented over vowel positions rather than syllables,
   * which is close enough outside of diphthong edge cases.
   */
  #stressedVowelIndex(text: string): number {
    const accented = [...text].findIndex((ch) => ch in ACCENTED && ch !== 'ü');
    if (accented >= 0) return accented;

    const vowelPositions: number[] = [];
    [...text].forEach((ch, index) => {
      if (VOWELS.has(ch)) vowelPositions.push(index);
    });
    if (vowelPositions.length === 0) return -1;

    const last = text.at(-1) ?? '';
    const penultimate = VOWELS.has(last) || last === 'n' || last === 's';
    const target = penultimate ? vowelPositions.length - 2 : vowelPositions.length - 1;
    return vowelPositions[Math.max(0, target)] ?? -1;
  }
}

export const spanishG2P: G2PEngine = new SpanishG2P({ seseo: true, yeismo: true });
