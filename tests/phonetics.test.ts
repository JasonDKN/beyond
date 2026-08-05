import { describe, expect, it, beforeAll } from 'vitest';
import { arpabetToPhones, toPhone } from '@/phonetics/arpabet';
import { renderIpa, splitIpaGlyphs, bareIpa } from '@/phonetics/ipa';
import { syllabify } from '@/phonetics/syllabify';
import { pronounceByRule } from '@/phonetics/g2p/en/rules';
import { englishG2P } from '@/phonetics/g2p/en';
import { spanishG2P } from '@/phonetics/g2p/es';
import { normalizeWord } from '@/phonetics/g2p/engine';
import { wordVowelHeight } from '@/phonetics/vowelspace';
import type { PhoneticWord } from '@/core/types';

const ipaOf = (word: string): string =>
  renderIpa(syllabify([...englishG2P.pronounce(word).phones]));

describe('ARPAbet → IPA', () => {
  it('uses the IPA script g, not ASCII g', () => {
    expect(toPhone('G').ipa).toBe('ɡ');
    expect(toPhone('G').ipa).not.toBe('g');
  });

  it('reduces unstressed AH to schwa and unstressed ER to hooked schwa', () => {
    expect(toPhone('AH0').ipa).toBe('ə');
    expect(toPhone('AH1').ipa).toBe('ʌ');
    expect(toPhone('ER0').ipa).toBe('ɚ');
    expect(toPhone('ER1').ipa).toBe('ɝ');
  });

  it('expands diphthongs to two symbols', () => {
    expect(arpabetToPhones('AY1 OW1 EY1').map((p) => p.ipa)).toEqual(['aɪ', 'oʊ', 'eɪ']);
  });

  it('marks vowels and consonants apart', () => {
    expect(toPhone('IY1').isVowel).toBe(true);
    expect(toPhone('CH').isVowel).toBe(false);
  });
});

describe('syllabification', () => {
  it('applies the maximum onset principle', () => {
    // "extra" — [ˈɛk.stɹə]: /kstɹ/ is not a legal onset, so /k/ stays in the coda.
    const syllables = syllabify(arpabetToPhones('EH1 K S T R AH0'));
    expect(syllables).toHaveLength(2);
    expect(syllables[0]?.coda.map((p) => p.ipa).join('')).toBe('k');
    expect(syllables[1]?.onset.map((p) => p.ipa).join('')).toBe('stɹ');
  });

  it('keeps legal clusters together as onsets', () => {
    // "apply" — [ə.ˈplaɪ]: /pl/ is a legal onset and moves as a unit.
    const syllables = syllabify(arpabetToPhones('AH0 P L AY1'));
    expect(syllables[1]?.onset.map((p) => p.ipa).join('')).toBe('pl');
  });

  it('gives the first syllable no onset it cannot have', () => {
    const syllables = syllabify(arpabetToPhones('S T R EH1 NG K TH'));
    expect(syllables).toHaveLength(1);
    expect(syllables[0]?.onset.map((p) => p.ipa).join('')).toBe('stɹ');
  });

  it('survives words with no vowel at all', () => {
    expect(() => syllabify(arpabetToPhones('M M'))).not.toThrow();
    expect(syllabify([])).toEqual([]);
  });

  it('accounts for every phone exactly once', () => {
    const phones = arpabetToPhones('B Y UW1 T AH0 F AH0 L');
    const syllables = syllabify(phones);
    const rebuilt = syllables.flatMap((s) => [...s.onset, ...s.nucleus, ...s.coda]);
    expect(rebuilt.map((p) => p.ipa)).toEqual(phones.map((p) => p.ipa));
  });
});

describe('IPA rendering', () => {
  it('places the stress mark before the whole syllable, onset included', () => {
    // "apply" — the mark belongs before /pl/, not between the p and the l, and
    // not after the onset. This is the assertion most implementations get wrong.
    expect(renderIpa(syllabify(arpabetToPhones('AH0 P L AY1')))).toBe('əˈplaɪ');
    expect(renderIpa(syllabify(arpabetToPhones('B EH1 T ER0')))).toBe('ˈbɛtɚ');
  });

  it('omits stress marks on monosyllables, where they carry no contrast', () => {
    expect(renderIpa(syllabify(arpabetToPhones('K AE1 T')))).toBe('kæt');
  });

  it('adds syllable breaks only when asked', () => {
    const syllables = syllabify(arpabetToPhones('B EH1 T ER0'));
    expect(renderIpa(syllables, { syllableBreaks: true })).toContain('.');
    expect(renderIpa(syllables)).not.toContain('.');
  });

  it('wraps in the requested delimiters', () => {
    const syllables = syllabify(arpabetToPhones('K AE1 T'));
    expect(renderIpa(syllables, { delimiters: 'phonemic' })).toBe('/kæt/');
    expect(renderIpa(syllables, { delimiters: 'phonetic' })).toBe('[kæt]');
  });

  it('splits affricates and diacritics as single glyphs', () => {
    expect(splitIpaGlyphs('tʃiːz')).toEqual(['tʃ', 'i', 'ː', 'z']);
    expect(bareIpa('ˈbɛt.ɚ')).toBe('bɛtɚ');
  });
});

describe('English G2P', () => {
  beforeAll(async () => {
    await englishG2P.load();
  });

  it('prefers the dictionary and marks it as such', () => {
    const result = englishG2P.pronounce('beyond');
    expect(result.source).toBe('lexicon');
    expect(result.confidence).toBe(1);
    expect(ipaOf('beyond')).toBe('bɪˈɑnd');
  });

  it('gets the irregulars a rule set could never get', () => {
    expect(ipaOf('colonel')).toBe('ˈkɝnəl');
    expect(ipaOf('choir')).toBe('ˈkwaɪɚ');
  });

  it('offers dictionary variants for words with more than one pronunciation', () => {
    const result = englishG2P.pronounce('either');
    expect(result.variants?.length ?? 0).toBeGreaterThan(0);
  });

  it('builds regular inflections from a listed stem', () => {
    // "ghost" is in CMUdict; "ghosting" is not.
    const result = englishG2P.pronounce('ghosting');
    expect(result.source).toBe('lexicon-inflected');
    expect(result.phones.map((p) => p.ipa).join('')).toBe('ɡoʊstɪŋ');
  });

  it('picks the right allomorph for the plural -s', () => {
    // "doorbell" is listed, "doorbells" is not. A voiced stem takes /z/.
    const voiced = englishG2P.pronounce('doorbells');
    expect(voiced.source).toBe('lexicon-inflected');
    expect(voiced.phones.at(-1)?.ipa).toBe('z');
  });

  it('collapses sung vowel elongation back to a real word', () => {
    // Both "soo" and "so" are dictionary entries; a five-letter run means the
    // singer was holding "so", so that is the one that should win.
    const result = englishG2P.pronounce('sooooo');
    expect(result.source).toBe('lexicon-inflected');
    expect(result.phones.map((p) => p.ipa).join('')).toBe('soʊ');
  });

  it('keeps a legitimately doubled letter when the run is only three', () => {
    // "fel" is also in the dictionary, so a naive collapse-to-one gets this wrong.
    const result = englishG2P.pronounce('feeel');
    expect(result.phones.map((p) => p.ipa).join('')).toBe('fil');
  });

  it('spells out digits', () => {
    expect(ipaOf('7')).toBe('ˈsɛvən');
  });

  it('falls back to rules for words no dictionary has, and says so', () => {
    const result = englishG2P.pronounce('zorbleflax');
    expect(result.source).toBe('rules');
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.phones.length).toBeGreaterThan(4);
  });
});

describe('English letter-to-sound rules', () => {
  it('handles digraphs and silent letters', () => {
    expect(pronounceByRule('knight')).toContain('N');
    expect(pronounceByRule('knight')).not.toContain('K');
    expect(pronounceByRule('phone')).toContain('F');
  });

  it('reads magic e as a long vowel', () => {
    expect(pronounceByRule('cake')).toContain('EY1');
    expect(pronounceByRule('bite')).toContain('AY1');
  });

  it('softens c and g before front vowels', () => {
    expect(pronounceByRule('cent')).toContain('S');
    expect(pronounceByRule('cat')).toContain('K');
  });

  it('always assigns exactly one primary stress to a word with a vowel', () => {
    for (const word of ['zorbleflax', 'quintarelli', 'skree', 'blorf']) {
      const stresses = pronounceByRule(word).split(' ').filter((p) => p.endsWith('1'));
      expect(stresses).toHaveLength(1);
    }
  });

  it('never throws on junk input', () => {
    for (const word of ['', '🎵', 'aaaaaa', "n'", '---']) {
      expect(() => pronounceByRule(word)).not.toThrow();
    }
  });
});

describe('Spanish G2P', () => {
  it('applies the standard stress rule', async () => {
    await spanishG2P.load();
    // "canción" — the written accent takes the stress to the final syllable.
    const phones = spanishG2P.pronounce('canción').phones;
    const stressed = phones.filter((p) => p.stress === 1);
    expect(stressed).toHaveLength(1);
    expect(stressed[0]?.ipa).toBe('o');
  });

  it('knows its digraphs and its trill/tap distinction', () => {
    const ipa = (word: string): string =>
      spanishG2P.pronounce(word).phones.map((p) => p.ipa).join('');
    expect(ipa('chico')).toBe('tʃiko');
    expect(ipa('rojo')).toBe('roxo'); // word-initial r trills
    expect(ipa('pero')).toBe('peɾo'); // intervocalic r taps
    expect(ipa('hola')).toBe('ola'); // h is silent
    expect(ipa('queso')).toBe('keso'); // the u in que is silent
  });
});

describe('word normalization', () => {
  it('strips surrounding punctuation but keeps internal marks', () => {
    expect(normalizeWord('"Don’t,"')).toBe("don't");
    expect(normalizeWord('well-worn!')).toBe('well-worn');
    expect(normalizeWord('¡Canción!')).toBe('canción');
  });
});

describe('vowel space', () => {
  it('places close vowels high and open vowels low', () => {
    const word = (ipa: string): PhoneticWord =>
      ({
        text: 'x',
        normalized: 'x',
        ipa,
        phones: [{ ipa, isVowel: true, stress: 1 }],
        syllables: [],
        source: 'lexicon',
        confidence: 1,
        startSec: 0,
        endSec: 1,
      }) as PhoneticWord;

    expect(wordVowelHeight(word('i'))).toBeGreaterThan(wordVowelHeight(word('ɛ')));
    expect(wordVowelHeight(word('ɛ'))).toBeGreaterThan(wordVowelHeight(word('ɑ')));
  });

  it('ignores length marks when looking a vowel up', () => {
    const long = { ipa: 'iː', isVowel: true, stress: 1 as const };
    const short = { ipa: 'i', isVowel: true, stress: 1 as const };
    const make = (phone: typeof long): PhoneticWord =>
      ({
        text: 'x',
        normalized: 'x',
        ipa: phone.ipa,
        phones: [phone],
        syllables: [],
        source: 'lexicon',
        confidence: 1,
        startSec: 0,
        endSec: 1,
      }) as PhoneticWord;
    expect(wordVowelHeight(make(long))).toBe(wordVowelHeight(make(short)));
  });
});
