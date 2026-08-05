import type { LanguageTag } from '@/core/types';
import type { G2PEngine } from './g2p/engine';
import { primarySubtag } from './g2p/engine';
import { englishG2P } from './g2p/en';
import { spanishG2P } from './g2p/es';
import { passthroughG2P } from './g2p/generic';

/**
 * The language registry — the single place that knows which engine handles
 * which language.
 *
 * To add a language: write a `G2PEngine`, import it, call `registerG2P`. That
 * is the whole contract. The UI reads `supportedG2PLanguages()` to build its
 * language menu, so a newly registered engine appears there automatically.
 */

const engines = new Map<string, G2PEngine>();

export function registerG2P(engine: G2PEngine): void {
  for (const tag of engine.languages) {
    engines.set(primarySubtag(tag), engine);
  }
}

/** Resolve the engine for a tag, falling back to the honest passthrough. */
export function resolveG2P(language: LanguageTag): G2PEngine {
  return engines.get(primarySubtag(language)) ?? passthroughG2P;
}

export function hasG2P(language: LanguageTag): boolean {
  return engines.has(primarySubtag(language));
}

export function supportedG2PLanguages(): string[] {
  return [...engines.keys()].sort();
}

registerG2P(englishG2P);
registerG2P(spanishG2P);
