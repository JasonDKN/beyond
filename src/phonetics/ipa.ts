import type { Notation, Phone, Syllable } from '@/core/types';
import { IPA_PRIMARY_STRESS, IPA_SECONDARY_STRESS } from './arpabet';
import { syllablePhones } from './syllabify';

export const SYLLABLE_BREAK = '.';

export interface RenderOptions {
  /** Wrap the result in `/slashes/` (phonemic) or `[brackets]` (phonetic). */
  readonly delimiters?: 'phonemic' | 'phonetic' | 'none';
  /** Insert `.` between syllables. Useful for singers, noisy for skimming. */
  readonly syllableBreaks?: boolean;
  readonly stressMarks?: boolean;
  readonly notation?: Notation;
}

const DEFAULTS: Required<RenderOptions> = {
  delimiters: 'none',
  syllableBreaks: false,
  stressMarks: true,
  notation: 'ipa',
};

/**
 * Symbols dropped in broad transcription, where fine detail is noise.
 * Written as an alternation rather than a character class because three of
 * these are combining marks, which a class would silently mis-handle.
 */
const NARROW_ONLY = /ʰ|ʲ|ʷ|̥|̩|̯|ː|ˑ/gu;

/** Render syllables as an IPA string with stress marks in the correct place. */
export function renderIpa(syllables: readonly Syllable[], options: RenderOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };

  const parts = syllables.map((syllable) => {
    const body = syllablePhones(syllable)
      .map((phone) => phone.ipa)
      .join('');
    if (!opts.stressMarks || syllable.stress === 0) return body;
    // IPA places the stress mark before the whole syllable, including its
    // onset — ˈstɹɛŋ.θən, never stɹˈɛŋθən.
    const mark = syllable.stress === 1 ? IPA_PRIMARY_STRESS : IPA_SECONDARY_STRESS;
    return mark + body;
  });

  // Only mark stress at all if the word has more than one syllable; a
  // monosyllable's stress is not contrastive and the mark just adds clutter.
  const joined =
    syllables.length > 1
      ? parts.join(opts.syllableBreaks ? SYLLABLE_BREAK : '')
      : parts.join('').replace(/^[ˈˌ]/u, '');

  const body = opts.notation === 'ipa-broad' ? joined.replace(NARROW_ONLY, '') : joined;

  switch (opts.delimiters) {
    case 'phonemic':
      return `/${body}/`;
    case 'phonetic':
      return `[${body}]`;
    default:
      return body;
  }
}

/** Render a flat phone list with no syllable structure (fallback path). */
export function renderPhones(phones: readonly Phone[]): string {
  return phones.map((phone) => phone.ipa).join('');
}

/**
 * Split an IPA string into user-visible glyph clusters.
 *
 * `Array.from` is not enough: `tʃ` is two code points but one segment to a
 * singer, and combining diacritics must ride along with their base letter.
 */
export function splitIpaGlyphs(ipa: string): string[] {
  const glyphs: string[] = [];
  const codepoints = Array.from(ipa);
  const AFFRICATE_SECONDS = new Set(['ʃ', 'ʒ', 's', 'z']);
  const AFFRICATE_FIRSTS = new Set(['t', 'd']);

  for (let i = 0; i < codepoints.length; i += 1) {
    const char = codepoints[i]!;
    if (/\p{Mn}/u.test(char) && glyphs.length > 0) {
      glyphs[glyphs.length - 1] += char;
      continue;
    }
    const next = codepoints[i + 1];
    if (next && AFFRICATE_FIRSTS.has(char) && AFFRICATE_SECONDS.has(next)) {
      glyphs.push(char + next);
      i += 1;
      continue;
    }
    glyphs.push(char);
  }
  return glyphs;
}

/** Strip stress and length marks — used when comparing two pronunciations. */
export function bareIpa(ipa: string): string {
  return ipa.replace(/[ˈˌ.ːˑ]/gu, '');
}
