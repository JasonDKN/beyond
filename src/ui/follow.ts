/**
 * When the score should follow the song, and when it should get out of the way.
 *
 * Follow-along has one hard problem: a `scroll` event does not say who caused
 * it. The reader dragging the list, our own smooth scroll, momentum still
 * unwinding after a finger lifted, the browser nudging a focused button into
 * view, a phone's address bar sliding away — all identical at the listener.
 *
 * The first version treated every one of them as "the reader wants to read",
 * and so follow-along switched itself off constantly, for reasons that were
 * invisible from the outside: tapping a word near the bottom of the screen,
 * one notch of a trackpad, rotating the phone. Being switched off is not a
 * disaster, but being switched off *for no visible reason* is, because there
 * is nothing to learn from it. You just stop trusting the feature.
 *
 * So intent is now inferred from three things together, and only pauses when
 * all three agree:
 *
 *  1. A real gesture happened — wheel, touch, drag, a navigation key. Scrolls
 *     with no gesture behind them are the browser's, not yours.
 *  2. The score actually moved a meaningful distance. A nudge is not a
 *     decision; leaving the sung line on screen is not "I want to be
 *     elsewhere".
 *  3. Our own scrolling is discounted entirely, including the tail of a smooth
 *     animation, which keeps emitting events well after the call returns.
 *
 * And because a pause is a statement about *now* rather than forever, follow
 * takes itself back once the song catches up to where you are looking and you
 * have stopped moving. Scroll ahead to see what is coming and it picks you up
 * when the song arrives. Scroll back to study a passage and it leaves you
 * there, because the sung line is nowhere near your eyes.
 */

export interface FollowConfig {
  /** Movement below this, in pixels, is a nudge rather than a decision. */
  readonly pausePx: number;
  /** …or this fraction of the visible score, whichever is larger. */
  readonly pauseFraction: number;
  /** How long after a gesture a scroll is still attributable to it. */
  readonly gestureWindowMs: number;
  /** A break longer than this ends the gesture; shorter is still momentum. */
  readonly gestureGapMs: number;
  /** How still things must be before follow may take over again. */
  readonly quietMs: number;
  /** How near the middle the sung line must be to count as "where you are looking". */
  readonly homeFraction: number;
}

export const FOLLOW_DEFAULTS: FollowConfig = {
  pausePx: 80,
  pauseFraction: 0.16,
  gestureWindowMs: 400,
  gestureGapMs: 250,
  quietMs: 900,
  homeFraction: 0.4,
};

export type FollowVerdict = 'keep' | 'pause' | 'resume';

/**
 * Has the reader moved far enough to mean it?
 *
 * Scaled to the viewport as well as an absolute floor: a third of a phone
 * screen is a deliberate swipe, while the same distance on a tall desktop
 * window barely disturbs the line you were reading.
 */
export function shouldPause(
  driftPx: number,
  viewportHeight: number,
  config: FollowConfig = FOLLOW_DEFAULTS,
): boolean {
  const threshold = Math.max(config.pausePx, viewportHeight * config.pauseFraction);
  return Math.abs(driftPx) >= threshold;
}

export interface ResumeReading {
  readonly now: number;
  readonly lastInputAt: number;
  readonly lastScrollAt: number;
  /**
   * Distance in pixels from the middle of the view to the middle of the line
   * being sung, or `null` when there is no such line on screen to measure.
   */
  readonly activeLineDistance: number | null;
  readonly viewportHeight: number;
}

/**
 * Should follow take itself back?
 *
 * Only when the song has arrived where you are already looking *and* you have
 * stopped scrolling. Resuming while a gesture is still in flight would fight
 * the reader for the scrollbar, which is the one thing worse than pausing too
 * eagerly.
 */
export function shouldResume(
  reading: ResumeReading,
  config: FollowConfig = FOLLOW_DEFAULTS,
): boolean {
  if (reading.activeLineDistance === null) return false;
  const still =
    reading.now - reading.lastInputAt >= config.quietMs &&
    reading.now - reading.lastScrollAt >= config.quietMs;
  const home = reading.activeLineDistance <= reading.viewportHeight * config.homeFraction;
  return still && home;
}

/**
 * The bookkeeping around those two decisions: which scrolls were yours, how
 * far they moved things, and how long ago they stopped.
 *
 * Kept apart from the view so it can be driven by a test with made-up clocks
 * instead of by a browser with real ones.
 */
export class FollowGuard {
  readonly #config: FollowConfig;

  #lastTop = 0;
  #drift = 0;
  #lastInputAt = Number.NEGATIVE_INFINITY;
  #lastScrollAt = Number.NEGATIVE_INFINITY;
  /** True while a gesture of the reader's is in progress, momentum included. */
  #live = false;
  /** Scrolling of our own making, to be ignored until this moment passes. */
  #muteUntil = Number.NEGATIVE_INFINITY;

  constructor(config: Partial<FollowConfig> = {}) {
    this.#config = { ...FOLLOW_DEFAULTS, ...config };
  }

  /** A gesture from the reader: wheel, touch, drag, a navigation key. */
  input(now: number): void {
    // A gesture that has produced no scrolling for a while is over, whatever
    // the flag still says. Otherwise distance travelled minutes ago would be
    // added to this gesture's, and one old swipe could pause follow-along on
    // the strength of a single fresh notch.
    const stale = now - this.#lastScrollAt > this.#config.gestureGapMs;
    if (!this.#live || stale) {
      this.#live = true;
      this.#drift = 0;
    }
    this.#lastInputAt = now;
  }

  /** We are about to move the score ourselves; disregard what that causes. */
  mute(now: number, forMs: number): void {
    this.#muteUntil = Math.max(this.#muteUntil, now + forMs);
  }

  /** Re-anchor after a rebuild, so a changed layout is not read as a scroll. */
  reset(top: number): void {
    this.#lastTop = top;
    this.#drift = 0;
    this.#live = false;
  }

  /** The score scrolled. Say whether that means follow should stand down. */
  scrolled(top: number, now: number, following: boolean, viewportHeight: number): FollowVerdict {
    const delta = top - this.#lastTop;
    this.#lastTop = top;

    // Our own animation. Note the time — resuming immediately afterwards would
    // be judging stillness we caused ourselves — but read nothing into it.
    if (now < this.#muteUntil) {
      this.#lastScrollAt = now;
      this.#drift = 0;
      return 'keep';
    }

    // A flick on a phone keeps emitting scrolls long after the finger has
    // gone. That is still the reader's scroll, so a gesture stays live as long
    // as events keep arriving without a real break.
    const continues = this.#live && now - this.#lastScrollAt <= this.#config.gestureGapMs;
    const begins = now - this.#lastInputAt <= this.#config.gestureWindowMs;
    this.#live = continues || begins;
    this.#lastScrollAt = now;

    if (!this.#live) {
      // Nobody asked for this one: a layout shift, a focused button being
      // brought into view, a restored position. Not a reading gesture.
      this.#drift = 0;
      return 'keep';
    }

    this.#lastInputAt = now;
    this.#drift += delta;

    if (!following) return 'keep';
    return shouldPause(this.#drift, viewportHeight, this.#config) ? 'pause' : 'keep';
  }

  /** With follow paused, has the song caught up to where the reader is? */
  resumable(now: number, activeLineDistance: number | null, viewportHeight: number): boolean {
    return shouldResume(
      {
        now,
        lastInputAt: this.#lastInputAt,
        lastScrollAt: this.#lastScrollAt,
        activeLineDistance,
        viewportHeight,
      },
      this.#config,
    );
  }
}
