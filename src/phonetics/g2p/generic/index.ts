import type { Phone } from '@/core/types';
import type { G2PEngine, Pronunciation } from '../engine';

/**
 * Fallback engine for languages Beyond has no rules for yet.
 *
 * It does not guess. It returns the letters themselves, flagged as
 * `passthrough` with zero confidence, so the UI can say plainly "no engine for
 * this language" instead of quietly inventing a pronunciation. An honest gap is
 * more useful to a singer than a confident fabrication.
 */
class PassthroughG2P implements G2PEngine {
  readonly id = 'passthrough';
  readonly label = 'No phonetic engine for this language yet';
  readonly languages: readonly string[] = [];
  readonly quality = 'placeholder' as const;

  async load(): Promise<void> {
    /* nothing to load */
  }

  pronounce(word: string): Pronunciation {
    const phones: Phone[] = [...word].map((ch) => ({ ipa: ch, isVowel: false }));
    return { phones, source: 'passthrough', confidence: 0 };
  }
}

export const passthroughG2P: G2PEngine = new PassthroughG2P();
