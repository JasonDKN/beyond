import { describe, expect, it } from 'vitest';
import { compose, decompose, decomposeWord, hasHangul } from '@/phonetics/g2p/ko/jamo';
import { applyPhonology } from '@/phonetics/g2p/ko/phonology';
import { koreanG2P } from '@/phonetics/g2p/ko';
import { segment } from '@/korean/morphology';
import type { Jamo } from '@/phonetics/g2p/ko/jamo';

/**
 * The test battery is the standard set of sound-change examples any Korean
 * phonology reference uses — ordinary vocabulary and place names, chosen
 * because each one isolates exactly one rule.
 */

/** Written Hangul → the Hangul that is actually pronounced. */
function spoken(word: string): string {
  const jamo = decomposeWord(word).filter((j): j is Jamo => j !== null);
  return applyPhonology(jamo).syllables.map(compose).join('');
}

const ipa = (word: string): string =>
  koreanG2P.pronounce(word).phones.map((p) => p.ipa).join('');

const respelling = (word: string): string => koreanG2P.pronounce(word).respelling ?? '';

describe('Hangul decomposition', () => {
  it('splits a block into its three slots', () => {
    expect(decompose('학')).toMatchObject({ onset: 'ㅎ', nucleus: 'ㅏ', coda: 'ㄱ' });
    expect(decompose('가')).toMatchObject({ onset: 'ㄱ', nucleus: 'ㅏ', coda: '' });
    expect(decompose('꽃')).toMatchObject({ onset: 'ㄲ', nucleus: 'ㅗ', coda: 'ㅊ' });
  });

  it('round-trips through compose', () => {
    for (const char of '안녕하세요반갑습니다한국어노래') {
      const jamo = decompose(char);
      expect(jamo).not.toBeNull();
      expect(compose(jamo!)).toBe(char);
    }
  });

  it('rejects non-Hangul without throwing', () => {
    expect(decompose('a')).toBeNull();
    expect(decompose('!')).toBeNull();
    expect(hasHangul('BTS')).toBe(false);
    expect(hasHangul('노래')).toBe(true);
  });
});

describe('Korean sound rules — spelling vs speech', () => {
  it('연음 — a final consonant slides into an empty next onset', () => {
    expect(spoken('옷이')).toBe('오시');
    expect(spoken('한국어')).toBe('한구거');
    expect(spoken('앉아')).toBe('안자');
  });

  it('ㅎ 탈락 — ㅎ goes silent before a vowel', () => {
    // The example every learner meets first, and the one every naive
    // romanization gets wrong by writing "joh-a-yo".
    expect(spoken('좋아요')).toBe('조아요');
  });

  it('격음화 — ㅎ merges with a stop and aspirates it', () => {
    expect(spoken('놓고')).toBe('노코');
    expect(spoken('좋다')).toBe('조타');
  });

  it('끝소리 규칙 — a syllable can only end in one of seven sounds', () => {
    expect(spoken('꽃')).toBe('꼳');
    expect(spoken('밖')).toBe('박');
    expect(spoken('앞')).toBe('압');
  });

  it('자음군 단순화 — two-consonant finals lose one', () => {
    expect(spoken('값')).toBe('갑');
    expect(spoken('닭')).toBe('닥');
  });

  it('경음화 — a lax consonant tenses after a stop', () => {
    expect(spoken('학교')).toBe('학꾜');
    expect(spoken('앉다')).toBe('안따');
  });

  it('비음화 — a stop before a nasal becomes a nasal', () => {
    expect(spoken('국민')).toBe('궁민');
    expect(spoken('감사합니다')).toBe('감사함니다');
  });

  it('유음화 — ㄴ and ㄹ meeting become ㄹㄹ', () => {
    expect(spoken('신라')).toBe('실라');
    expect(spoken('설날')).toBe('설랄');
  });

  it('ㄹ 비음화 — ㄹ becomes ㄴ after a nasal or a stop', () => {
    expect(spoken('종로')).toBe('종노');
    expect(spoken('독립')).toBe('동닙'); // two rules chain: ㄹ→ㄴ, then ㄱ→ㅇ
  });

  it('구개음화 — ㄷ/ㅌ before 이 becomes ㅈ/ㅊ', () => {
    expect(spoken('같이')).toBe('가치');
    expect(spoken('굳이')).toBe('구지');
  });

  it('leaves words alone when no rule applies', () => {
    for (const word of ['노래', '사랑', '바다', '아니']) {
      expect(spoken(word)).toBe(word);
    }
  });
});

describe('Korean IPA', () => {
  it('keeps the three-way lax / tense / aspirated contrast distinct', () => {
    expect(ipa('가')).toBe('ka');
    expect(ipa('까')).toBe('k͈a');
    expect(ipa('카')).toBe('kʰa');
  });

  it('voices lax stops between voiced sounds', () => {
    // 한국 — the ㄱ sits between a nasal and a vowel, so it voices.
    expect(ipa('한국')).toBe('hanɡuk̚');
    // Word-initially it stays voiceless.
    expect(ipa('국')).toBe('kuk̚');
  });

  it('palatalizes ㅅ before i and j', () => {
    expect(ipa('시')).toBe('ɕi');
    expect(ipa('사')).toBe('sa');
  });

  it('marks final stops as unreleased', () => {
    expect(ipa('밥')).toBe('pap̚');
  });

  it('geminates ㄹㄹ rather than tapping it', () => {
    expect(ipa('신라')).toBe('ɕilla');
  });

  it('writes glides as separate segments', () => {
    expect(ipa('야')).toBe('ja');
    expect(ipa('왜')).toBe('we');
  });

  it('merges ㅐ and ㅔ, as contemporary Seoul speech does', () => {
    expect(ipa('개')).toBe(ipa('게'));
  });

  it('passes non-Korean tokens through honestly rather than guessing', () => {
    const result = koreanG2P.pronounce('love');
    expect(result.source).toBe('passthrough');
    expect(result.confidence).toBe(0);
  });
});

describe('learner respelling', () => {
  it('is built from the spoken form, not the spelling', () => {
    // A spelling-based romanization gives "joh-a-yo" and teaches a silent ㅎ
    // that nobody pronounces. This is built after the rules have run.
    expect(respelling('좋아요')).toBe('jo-ah-yo');
    expect(respelling('학교')).toBe('hahk-kkyo');
  });

  it('spells vowels for the sound, even when it looks unfamiliar', () => {
    // "sheel-lah", not the more expected-looking "shil-la". An English reader
    // says "shil" with the /ɪ/ of "fill"; Korean 이 is a true /i/, the vowel
    // of "feel". Looking slightly odd on the page is a cheap price for being
    // read correctly out loud, which is the only thing this layer is for.
    expect(respelling('신라')).toBe('sheel-lah');
    expect(respelling('감사합니다')).toBe('gahm-sah-hahm-nee-dah');
  });

  it('hyphenates every syllable, because Korean is syllable-timed', () => {
    expect(respelling('감사합니다').split('-')).toHaveLength(5);
  });
});

describe('pronunciation reporting', () => {
  it('flags when the spelling and the spoken form differ', () => {
    expect(koreanG2P.pronounce('좋아요').changed).toBe(true);
    expect(koreanG2P.pronounce('노래').changed).toBe(false);
  });

  it('names the rules that fired, in Korean and in English', () => {
    const notes = koreanG2P.pronounce('학교').notes ?? [];
    expect(notes.some((note) => note.rule === 'tensification')).toBe(true);
    expect(notes.some((note) => note.label === '경음화')).toBe(true);
  });

  it('supplies its own syllables rather than leaving them to be inferred', () => {
    const result = koreanG2P.pronounce('감사합니다');
    expect(result.syllables).toHaveLength(5);
  });
});

describe('morpheme segmentation', () => {
  it('separates a topic particle from its noun', () => {
    const parts = segment('노래는');
    expect(parts.map((p) => p.text)).toEqual(['노래', '는']);
    expect(parts[1]?.gloss).toBe('topic marker');
  });

  it('peels a stack of endings inside-out', () => {
    const parts = segment('먹었어요');
    expect(parts[0]?.kind).toBe('stem');
    const glosses = parts.map((p) => p.gloss);
    expect(glosses).toContain('past tense');
    expect(glosses).toContain('polite casual');
  });

  it('never strips a word down to nothing', () => {
    for (const word of ['는', '이', '요', '다']) {
      const parts = segment(word);
      expect(parts).toHaveLength(1);
      expect(parts[0]?.kind).toBe('stem');
    }
  });

  it('leaves an unknown word as a bare stem', () => {
    const parts = segment('바다');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toBe('바다');
  });
});
