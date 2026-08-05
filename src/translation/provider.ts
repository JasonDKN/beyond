import type { LanguageTag, PhoneticScore } from '@/core/types';

/**
 * Translation — the second half of "leave room for multiple languages".
 *
 * Input language governs how a line is *pronounced*; output language governs
 * what it is rendered *as*. A user learning to sing a Portuguese fado wants the
 * IPA of the Portuguese and the meaning in English, side by side. Deliberately
 * a separate axis from the phonetics, and deliberately optional.
 *
 * No engine ships by default. Register one and the UI's output-language menu
 * lights up on its own.
 */

export interface TranslationRequest {
  readonly lines: readonly string[];
  readonly from: LanguageTag;
  readonly to: LanguageTag;
  readonly signal?: AbortSignal;
}

export interface TranslationProvider {
  readonly id: string;
  readonly label: string;
  readonly targets: readonly LanguageTag[];
  available(): Promise<{ ok: boolean; reason?: string }>;
  /** Must return one translation per input line, in order. */
  translate(request: TranslationRequest): Promise<string[]>;
}

const providers = new Map<string, TranslationProvider>();

export function registerTranslationProvider(provider: TranslationProvider): void {
  providers.set(provider.id, provider);
}

export function listTranslationProviders(): TranslationProvider[] {
  return [...providers.values()];
}

export function hasTranslation(): boolean {
  return providers.size > 0;
}

/** Attach translations to a score, line by line. No-op when nothing is registered. */
export async function translateScore(
  score: PhoneticScore,
  to: LanguageTag,
  providerId?: string,
): Promise<PhoneticScore> {
  const provider = providerId
    ? providers.get(providerId)
    : [...providers.values()].find((candidate) => candidate.targets.includes(to));
  if (!provider) return { ...score, outputLanguage: to };

  const translations = await provider.translate({
    lines: score.lines.map((line) => line.text),
    from: score.inputLanguage,
    to,
  });

  return {
    ...score,
    outputLanguage: to,
    lines: score.lines.map((line, index) => {
      const translated = translations[index];
      return translated ? { ...line, translation: translated } : line;
    }),
  };
}
