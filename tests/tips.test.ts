import { describe, expect, it } from 'vitest';
import { parseTip } from '@/ui/tips';
import { defaultModeFor } from '@/ui/modeSwitch';

describe('reading a hovertip', () => {
  it('takes the first line as the heading and the rest as the body', () => {
    const tip = parseTip('Timed at 0:33\nClick to aim the next tap at this line');
    expect(tip.title).toEqual([{ kind: 'text', text: 'Timed at 0:33' }]);
    expect(tip.body).toHaveLength(1);
  });

  it('renders a backticked word as a key', () => {
    // The whole reason to own the tooltip: `T` should look like a key, not
    // like a capital letter in the middle of a sentence.
    const tip = parseTip('Aim\n`↑` `↓` move the aim · `T` times it');
    expect(tip.body[0]).toEqual([
      { kind: 'key', text: '↑' },
      { kind: 'text', text: ' ' },
      { kind: 'key', text: '↓' },
      { kind: 'text', text: ' move the aim · ' },
      { kind: 'key', text: 'T' },
      { kind: 'text', text: ' times it' },
    ]);
  });

  it('handles a heading with a key in it', () => {
    expect(parseTip('Press `Esc` to close').title).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'key', text: 'Esc' },
      { kind: 'text', text: ' to close' },
    ]);
  });

  it('copes with a one-line tip', () => {
    const tip = parseTip('Mute / unmute');
    expect(tip.title).toEqual([{ kind: 'text', text: 'Mute / unmute' }]);
    expect(tip.body).toEqual([]);
  });

  it('drops blank lines rather than drawing empty rows', () => {
    expect(parseTip('One\n\n\nTwo').body).toHaveLength(1);
  });

  it('survives an unbalanced backtick without losing the text', () => {
    const flat = parseTip('press `T to time it').title.map((s) => s.text).join('');
    expect(flat).toBe('press T to time it');
  });
});

describe('which view a song opens in', () => {
  it('starts in Setup when there are no words yet', () => {
    expect(defaultModeFor({ hasScore: false, totalLines: 0, timedLines: 0 })).toBe('setup');
  });

  it('goes to Beatmap once there are words to time', () => {
    expect(defaultModeFor({ hasScore: false, totalLines: 12, timedLines: 0 })).toBe('beatmap');
    expect(defaultModeFor({ hasScore: false, totalLines: 12, timedLines: 11 })).toBe('beatmap');
  });

  it('goes to Learning once everything is timed and built', () => {
    expect(defaultModeFor({ hasScore: true, totalLines: 12, timedLines: 12 })).toBe('learning');
  });

  it('stays in Beatmap when the timing is done but no score exists', () => {
    expect(defaultModeFor({ hasScore: false, totalLines: 12, timedLines: 12 })).toBe('beatmap');
  });
});
