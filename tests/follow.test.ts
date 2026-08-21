import { describe, expect, it } from 'vitest';
import { FollowGuard, shouldPause, shouldResume, FOLLOW_DEFAULTS } from '@/ui/follow';

/**
 * Whether the score keeps up with the song, and who gets to decide.
 *
 * A `scroll` event does not say who caused it, so all of this is inference.
 * These are the cases the inference has to get right — most of them scrolls
 * that were nobody's decision at all.
 */

const VIEW = 600;

describe('how far counts as meaning it', () => {
  it('ignores a nudge', () => {
    expect(shouldPause(12, VIEW)).toBe(false);
    expect(shouldPause(-30, VIEW)).toBe(false);
  });

  it('takes a real scroll seriously, in either direction', () => {
    expect(shouldPause(200, VIEW)).toBe(true);
    expect(shouldPause(-200, VIEW)).toBe(true);
  });

  it('scales with the screen, so a phone is not held to a desktop distance', () => {
    // The same 90px is most of a short viewport and very little of a tall one.
    expect(shouldPause(90, 300)).toBe(true);
    expect(shouldPause(90, 2000)).toBe(false);
  });
});

describe('when follow may take itself back', () => {
  const settled = {
    now: 10_000,
    lastInputAt: 8_000,
    lastScrollAt: 8_000,
    activeLineDistance: 40,
    viewportHeight: VIEW,
  };

  it('resumes once the song reaches where you are reading', () => {
    expect(shouldResume(settled)).toBe(true);
  });

  it('stays out of the way while you are still scrolling', () => {
    expect(shouldResume({ ...settled, lastScrollAt: 9_950 })).toBe(false);
    expect(shouldResume({ ...settled, lastInputAt: 9_950 })).toBe(false);
  });

  it('leaves you alone when the song is nowhere near your eyes', () => {
    // Scrolling back to study an earlier passage: the sung line is far below,
    // and dragging you back to it is the opposite of what you asked for.
    expect(shouldResume({ ...settled, activeLineDistance: 900 })).toBe(false);
  });

  it('does nothing when there is no sung line to measure against', () => {
    expect(shouldResume({ ...settled, activeLineDistance: null })).toBe(false);
  });
});

describe('reading intent from a stream of scroll events', () => {
  /** A guard that has been sitting at the top of the score for a while. */
  const fresh = (): FollowGuard => {
    const guard = new FollowGuard();
    guard.reset(0);
    return guard;
  };

  it('ignores scrolling it caused itself', () => {
    const guard = fresh();
    guard.mute(1_000, 700);
    // Our own smooth scroll, arriving in pieces over half a second.
    for (let at = 1_010; at < 1_500; at += 60) {
      expect(guard.scrolled(at - 1_000, at, true, VIEW)).toBe('keep');
    }
  });

  it('ignores a scroll nobody asked for', () => {
    // A layout shift, a focused button pulled into view, a restored position:
    // a large jump with no gesture behind it. This was the old bug — clicking
    // a word near the bottom of the screen switched follow off.
    const guard = fresh();
    expect(guard.scrolled(500, 1_000, true, VIEW)).toBe('keep');
  });

  it('pauses when the reader deliberately scrolls away', () => {
    const guard = fresh();
    guard.input(1_000);
    expect(guard.scrolled(60, 1_020, true, VIEW)).toBe('keep');
    expect(guard.scrolled(140, 1_060, true, VIEW)).toBe('pause');
  });

  it('does not pause for a single notch of a wheel', () => {
    const guard = fresh();
    guard.input(1_000);
    expect(guard.scrolled(40, 1_020, true, VIEW)).toBe('keep');
  });

  it('counts the momentum after a finger lifts as part of the same flick', () => {
    // A phone keeps emitting scrolls long after the touch has ended. Those
    // are still the reader's scroll, and a flick must be able to pause follow.
    const guard = fresh();
    guard.input(1_000);
    let verdict = guard.scrolled(30, 1_010, true, VIEW);
    for (let at = 1_100, top = 60; verdict === 'keep' && at < 2_000; at += 100, top += 40) {
      verdict = guard.scrolled(top, at, true, VIEW);
    }
    expect(verdict).toBe('pause');
  });

  it('forgets a gesture once the scrolling has really stopped', () => {
    const guard = fresh();
    guard.input(1_000);
    guard.scrolled(50, 1_020, true, VIEW);
    // Seconds later, something scrolls the list with no gesture behind it.
    expect(guard.scrolled(400, 9_000, true, VIEW)).toBe('keep');
  });

  it('hands follow back when the song catches up and the reader is still', () => {
    const guard = fresh();
    guard.input(1_000);
    guard.scrolled(300, 1_050, true, VIEW);

    // Straight away, while the gesture is barely over: not yet.
    expect(guard.resumable(1_200, 20, VIEW)).toBe(false);
    // A second later, with the sung line arriving near the middle: yes.
    expect(guard.resumable(3_000, 20, VIEW)).toBe(true);
  });

  it('does not hand it back while the reader is somewhere else entirely', () => {
    const guard = fresh();
    guard.input(1_000);
    guard.scrolled(300, 1_050, true, VIEW);
    expect(guard.resumable(9_000, 800, VIEW)).toBe(false);
  });

  it('starts each gesture from zero, so old distance cannot pause it later', () => {
    const guard = fresh();
    guard.input(1_000);
    guard.scrolled(70, 1_020, true, VIEW); // most of the way to the threshold
    guard.input(6_000); // a new gesture, long afterwards
    expect(guard.scrolled(100, 6_020, true, VIEW)).toBe('keep');
  });

  it('never pauses something that is already paused', () => {
    const guard = fresh();
    guard.input(1_000);
    expect(guard.scrolled(400, 1_020, false, VIEW)).toBe('keep');
  });
});

describe('the settings themselves', () => {
  it('waits longer to resume than it does to notice a gesture', () => {
    // Resuming faster than a gesture can be recognised would fight the reader
    // for the scrollbar mid-swipe.
    expect(FOLLOW_DEFAULTS.quietMs).toBeGreaterThan(FOLLOW_DEFAULTS.gestureWindowMs);
    expect(FOLLOW_DEFAULTS.quietMs).toBeGreaterThan(FOLLOW_DEFAULTS.gestureGapMs);
  });
});
