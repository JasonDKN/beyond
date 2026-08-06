import type { LanguageTag } from './types';

export interface LanguageInfo {
  readonly tag: LanguageTag;
  readonly englishName: string;
  readonly nativeName: string;
  /** Whisper can transcribe this; a phonetic engine may still be missing. */
  readonly asr: boolean;
}

/**
 * Languages offered in the input menu.
 *
 * ASR coverage and phonetic coverage are deliberately separate concerns: a
 * language can be transcribable long before Beyond can phonemize it, and the UI
 * should say so rather than pretend. `hasG2P()` from the phonetics registry
 * supplies the other half.
 */
export const LANGUAGES: readonly LanguageInfo[] = [
  { tag: 'auto', englishName: 'Detect automatically', nativeName: 'Detect', asr: true },
  { tag: 'en', englishName: 'English', nativeName: 'English', asr: true },
  { tag: 'es', englishName: 'Spanish', nativeName: 'Español', asr: true },
  { tag: 'fr', englishName: 'French', nativeName: 'Français', asr: true },
  { tag: 'de', englishName: 'German', nativeName: 'Deutsch', asr: true },
  { tag: 'it', englishName: 'Italian', nativeName: 'Italiano', asr: true },
  { tag: 'pt', englishName: 'Portuguese', nativeName: 'Português', asr: true },
  { tag: 'ko', englishName: 'Korean', nativeName: '한국어', asr: true },
  { tag: 'ja', englishName: 'Japanese', nativeName: '日本語', asr: true },
  { tag: 'zh', englishName: 'Chinese', nativeName: '中文', asr: true },
  { tag: 'ru', englishName: 'Russian', nativeName: 'Русский', asr: true },
  { tag: 'ar', englishName: 'Arabic', nativeName: 'العربية', asr: true },
  { tag: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', asr: true },
  { tag: 'vi', englishName: 'Vietnamese', nativeName: 'Tiếng Việt', asr: true },
  { tag: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', asr: true },
  { tag: 'sv', englishName: 'Swedish', nativeName: 'Svenska', asr: true },
  { tag: 'pl', englishName: 'Polish', nativeName: 'Polski', asr: true },
  { tag: 'tr', englishName: 'Turkish', nativeName: 'Türkçe', asr: true },
];

export function languageInfo(tag: LanguageTag): LanguageInfo | undefined {
  const primary = tag.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((entry) => entry.tag === primary);
}

export function languageLabel(tag: LanguageTag): string {
  return languageInfo(tag)?.englishName ?? tag;
}
