import type { DisplayLayers } from '@/core/store';
import type { PhoneticWord } from '@/core/types';

/**
 * Which readings of a word to draw, given what you asked to see.
 *
 * Pulled out of the renderer because the rules are not obvious and one of
 * them was wrong in a way nobody could have seen by reading the markup: with
 * only Spoken switched on, words simply vanished from the score.
 *
 * The cause was a rule that is right in company and wrong alone. The spoken
 * layer exists to teach a divergence — 좋아요 written, 조아요 said — so it was
 * suppressed whenever the two agreed, on the sound reasoning that printing
 * 노래 twice teaches nothing. But "say nothing when it matches the spelling"
 * silently becomes "say nothing at all" the moment the spelling is not also
 * on screen. Every unchanged word rendered as an empty box: all the Latin
 * words in a Korean lyric, which have no separate spoken form at all, and
 * every Korean word that happens to be said as it is written.
 *
 * So the suppression is now conditional on the written layer actually being
 * there to do the job. On its own, Spoken means what you say — and for a word
 * pronounced as it is spelled, what you say is the spelling.
 */

export type LayerKind = 'written' | 'spoken' | 'ipa' | 'respelling';

export interface LayerLine {
  readonly kind: LayerKind;
  readonly text: string;
}

export function visibleLayers(word: PhoneticWord, layers: DisplayLayers): LayerLine[] {
  const lines: LayerLine[] = [];

  if (layers.written && word.text) {
    lines.push({ kind: 'written', text: word.text });
  }

  if (layers.pronounced) {
    const said = word.changed && word.pronouncedForm ? word.pronouncedForm : word.text;
    // Skip it only when the written layer is already showing these very
    // characters; otherwise it is the only thing standing between you and a
    // blank space where a word should be.
    const duplicate = layers.written && said === word.text;
    if (said && !duplicate) lines.push({ kind: 'spoken', text: said });
  }

  if (layers.ipa && word.ipa) {
    lines.push({ kind: 'ipa', text: word.ipa });
  }

  if (layers.respelling && word.respelling) {
    lines.push({ kind: 'respelling', text: word.respelling });
  }

  /*
   * Whatever else happens, a word is never drawn as nothing.
   *
   * Every layer is optional and several depend on data a given word may not
   * have — a respelling, an IPA string, a divergence worth showing. Any
   * combination can therefore come up empty, and an empty word is worse than
   * a redundant one: the line silently loses a piece and you cannot tell
   * whether the app is broken or the song really goes like that.
   */
  if (lines.length === 0 && word.text) {
    lines.push({ kind: 'written', text: word.text });
  }

  return lines;
}
