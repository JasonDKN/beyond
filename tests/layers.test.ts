import { describe, expect, it } from 'vitest';
import { visibleLayers } from '@/ui/layers';
import type { DisplayLayers } from '@/core/store';
import type { PhoneticWord } from '@/core/types';

/**
 * Which readings of a word appear, and — the part that was broken — that
 * something always does.
 */

const show = (on: Partial<DisplayLayers>): DisplayLayers => ({
  written: false,
  pronounced: false,
  ipa: false,
  respelling: false,
  morphemes: false,
  translation: false,
  ...on,
});

const word = (over: Partial<PhoneticWord> = {}): PhoneticWord =>
  ({
    text: '노래',
    ipa: 'noɾe',
    startSec: 0,
    endSec: 1,
    confidence: 1,
    source: 'derived',
    syllables: [],
    ...over,
  }) as PhoneticWord;

/** A word said differently from how it is spelled — the teachable case. */
const changed = word({ text: '좋아요', pronouncedForm: '조아요', changed: true, ipa: 'tɕoajo' });
/** An English word inside a Korean lyric: no separate spoken form exists. */
const english = word({ text: 'Baby', ipa: 'beɪbi', respelling: 'bay-bee' });

describe('with everything on', () => {
  const all = show({ written: true, pronounced: true, ipa: true, respelling: true });

  it('shows the spoken form only where it differs', () => {
    expect(visibleLayers(changed, all).map((l) => l.kind)).toEqual(['written', 'spoken', 'ipa']);
    // 노래 is said as it is written, so printing it twice teaches nothing.
    expect(visibleLayers(word(), all).map((l) => l.kind)).toEqual(['written', 'ipa']);
  });

  it('shows a respelling when the word has one', () => {
    expect(visibleLayers(english, all).map((l) => l.text)).toEqual([
      'Baby',
      'beɪbi',
      'bay-bee',
    ]);
  });
});

describe('with only Spoken on', () => {
  const spoken = show({ pronounced: true });

  it('shows the spoken form of a word that changes', () => {
    expect(visibleLayers(changed, spoken)).toEqual([{ kind: 'spoken', text: '조아요' }]);
  });

  it('shows a Korean word that is said as it is written', () => {
    // The reported bug: "only when it differs" quietly became "never", because
    // the written layer was not there to carry the word instead.
    expect(visibleLayers(word(), spoken)).toEqual([{ kind: 'spoken', text: '노래' }]);
  });

  it('shows an English word inside a Korean lyric', () => {
    // These have no spoken form at all, so they vanished entirely.
    expect(visibleLayers(english, spoken)).toEqual([{ kind: 'spoken', text: 'Baby' }]);
  });

  it('never returns nothing, whatever the word', () => {
    for (const w of [changed, english, word(), word({ ipa: '' })]) {
      expect(visibleLayers(w, spoken).length).toBeGreaterThan(0);
    }
  });
});

describe('no combination of layers ever draws a blank word', () => {
  const kinds = ['written', 'pronounced', 'ipa', 'respelling'] as const;

  it('holds for every one of the sixteen combinations', () => {
    // A word with nothing optional on it at all — no respelling, no spoken
    // form, no IPA — is the worst case, and the one most likely to appear in
    // a language whose engine knows little.
    const bare = word({ text: 'aaa', ipa: '' });

    for (let mask = 0; mask < 16; mask += 1) {
      const on = Object.fromEntries(
        kinds.map((kind, index) => [kind, Boolean(mask & (1 << index))]),
      ) as Partial<DisplayLayers>;
      const lines = visibleLayers(bare, show(on));
      expect(lines.length, `layers ${JSON.stringify(on)}`).toBeGreaterThan(0);
      expect(lines.every((l) => l.text.length > 0)).toBe(true);
    }
  });

  it('falls back to the spelling when a word has no IPA and only IPA is asked for', () => {
    expect(visibleLayers(word({ ipa: '' }), show({ ipa: true }))).toEqual([
      { kind: 'written', text: '노래' },
    ]);
  });

  it('falls back when only a respelling is asked for and there is none', () => {
    expect(visibleLayers(word(), show({ respelling: true }))).toEqual([
      { kind: 'written', text: '노래' },
    ]);
  });
});
