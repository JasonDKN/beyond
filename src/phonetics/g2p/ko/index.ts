import type { Morpheme, Phone, Syllable } from '@/core/types';
import { segment } from '@/korean/morphology';
import type { G2PEngine, Pronunciation } from '../engine';
import { compose, decompose, hasHangul, type Jamo } from './jamo';
import { applyPhonology, DEFAULT_PHONOLOGY, type PhonologyOptions } from './phonology';
import { DEFAULT_KOREAN_IPA, toIpaSyllables, type KoreanIpaOptions } from './ipa';
import { respell } from './respell';

/**
 * Korean G2P.
 *
 * No dictionary, and none needed. Hangul already encodes the phonemes; what it
 * hides is the sound changes between them, and those are rules. The whole
 * engine is `decompose → applyPhonology → toIpaSyllables`, which is the shape
 * the writing system hands you.
 *
 * The engine emits three parallel readings of every word, because a learner
 * needs different ones on different days:
 *
 *   the Hangul as written      — what is on the lyric sheet
 *   the Hangul as pronounced   — what the singer's mouth is doing
 *   IPA, and a plain respelling — how to make that noise
 *
 * The gap between the first two is the thing no romanization shows you, and
 * it is where nearly every mispronunciation a self-taught singer makes lives.
 */

export interface KoreanOptions {
  readonly phonology: PhonologyOptions;
  readonly ipa: KoreanIpaOptions;
}

class KoreanG2P implements G2PEngine {
  readonly id = 'ko-rules';
  readonly label = 'Korean — standard pronunciation rules (표준 발음법)';
  readonly languages = ['ko'] as const;
  readonly quality = 'rules' as const;

  #options: KoreanOptions = {
    phonology: DEFAULT_PHONOLOGY,
    ipa: DEFAULT_KOREAN_IPA,
  };

  configure(options: Partial<KoreanOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  async load(): Promise<void> {
    /* Rules are the engine — nothing to fetch. Works offline, on a plane. */
  }

  /**
   * Break a word into stem plus grammar.
   *
   * Korean stacks suffixes onto a stem, and each one carries a piece of
   * meaning. Naming them is what turns a lyric you have memorised into
   * grammar you can reuse on the next song.
   */
  analyze(word: string): readonly Morpheme[] {
    if (!hasHangul(word)) return [];
    return segment(word);
  }

  pronounce(word: string): Pronunciation {
    if (!word) return { phones: [], source: 'rules', confidence: 0 };

    // K-pop lyrics are bilingual as a matter of course. A token with no Hangul
    // in it is English (or a number), and lying about it helps nobody.
    if (!hasHangul(word)) {
      return {
        phones: [...word].map<Phone>((ch) => ({ ipa: ch, isVowel: false })),
        source: 'passthrough',
        confidence: 0,
      };
    }

    // Non-Hangul characters inside a mixed token are dropped from the phonetic
    // reading rather than mangled; the original text is still displayed above.
    const written: Jamo[] = [];
    for (const char of word) {
      const jamo = decompose(char);
      if (jamo) written.push(jamo);
    }
    if (written.length === 0) {
      return { phones: [], source: 'passthrough', confidence: 0 };
    }

    const { syllables: spoken, applied } = applyPhonology(written, this.#options.phonology);
    const ipaSyllables = toIpaSyllables(spoken, this.#options.ipa);

    const phones = flatten(ipaSyllables);
    const pronouncedForm = spoken.map((jamo) => compose(jamo)).join('');
    const writtenForm = written.map((jamo) => jamo.source).join('');

    return {
      phones,
      syllables: ipaSyllables,
      // `derived`, not `rules`. English letter-to-sound rules are a guess made
      // when the dictionary fails; Korean rules are the actual grammar of the
      // language's pronunciation, applied to an orthography regular enough to
      // support them. Calling both "guessed" would tell the user to distrust a
      // reading that is very likely correct.
      source: 'derived',
      // Korean orthography is regular enough that the rules are close to
      // authoritative. The remaining uncertainty is real but narrow: it sits in
      // compound-boundary effects (ㄴ-insertion, some tensification) that need
      // morphology this engine does not have.
      confidence: 0.92,
      respelling: respell(ipaSyllables),
      pronouncedForm,
      changed: pronouncedForm !== writtenForm,
      notes: applied.map((rule) => ({
        at: rule.at,
        rule: rule.rule,
        label: rule.korean,
        explanation: rule.note,
      })),
    };
  }
}

function flatten(syllables: readonly Syllable[]): Phone[] {
  return syllables.flatMap((syllable) => [...syllable.onset, ...syllable.nucleus, ...syllable.coda]);
}

export const koreanG2P = new KoreanG2P();
