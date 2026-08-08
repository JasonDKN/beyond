import type { PhoneticScore, PhoneticWord, Syllable } from '@/core/types';

/**
 * The syllables a take should have hit, pulled off the built score.
 *
 * Practice mode grades against the grid you produced by tapping — not against
 * anything the app guessed. That is what makes the timing score trustworthy in
 * a way a pronunciation grade is not: the reference is yours.
 */

export interface ExpectedSyllable {
  readonly startSec: number;
  /** The Hangul block, or the syllable's IPA where the script is not syllabic. */
  readonly glyph: string;
  readonly ipa: string;
  readonly lineIndex: number;
  readonly wordStart: boolean;
}

/** Collect every syllable whose onset falls inside a time range. */
export function expectedSyllables(
  score: PhoneticScore | null,
  fromSec: number,
  toSec: number,
): ExpectedSyllable[] {
  if (!score) return [];
  const out: ExpectedSyllable[] = [];

  score.lines.forEach((line, lineIndex) => {
    if (line.endSec < fromSec || line.startSec > toSec) return;
    for (const word of line.words) {
      const glyphs = syllabicGlyphs(word);
      word.syllables.forEach((syllable, index) => {
        const startSec = syllableStart(syllable, word, index);
        if (startSec < fromSec || startSec > toSec) return;
        out.push({
          startSec,
          glyph: glyphs[index] ?? syllableIpa(syllable),
          ipa: syllableIpa(syllable),
          lineIndex,
          wordStart: index === 0,
        });
      });
    }
  });

  return out.sort((a, b) => a.startSec - b.startSec);
}

function syllableIpa(syllable: Syllable): string {
  return [...syllable.onset, ...syllable.nucleus, ...syllable.coda].map((p) => p.ipa).join('');
}

/** Hangul blocks, one per syllable, when the word is written in Hangul. */
function syllabicGlyphs(word: PhoneticWord): string[] {
  const source = word.pronouncedForm ?? word.text;
  const blocks = [...source].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0xac00 && code <= 0xd7a3;
  });
  return blocks.length === word.syllables.length ? blocks : [];
}

/**
 * When a syllable begins.
 *
 * Prefers the timings the pipeline distributed across the phones; falls back
 * to an even split of the word when those are absent.
 */
function syllableStart(syllable: Syllable, word: PhoneticWord, index: number): number {
  const phones = [...syllable.onset, ...syllable.nucleus, ...syllable.coda];
  const start = phones.find((phone) => phone.startSec !== undefined)?.startSec;
  if (start !== undefined) return start;
  const span = (word.endSec - word.startSec) / Math.max(1, word.syllables.length);
  return word.startSec + index * span;
}
