import { Emitter } from '@/core/events';
import type { AudioSource } from '@/core/types';

type PlayerEvents = {
  play: void;
  pause: void;
  ended: void;
  seek: number;
  /** Fires once per animation frame while playing, for the staff to follow. */
  tick: number;
  ratechange: number;
  loopchange: { start: number; end: number } | null;
};

/**
 * Playback transport.
 *
 * Backed by a plain <audio> element rather than an AudioBufferSourceNode:
 * elements give us seeking, rate changes, and buffering for free, and for a
 * lyric view we need position far more than we need sample-accurate scheduling.
 * Position is polled on rAF because `timeupdate` fires only ~4×/second, which
 * is visibly choppy when glyphs are illuminating in time with a vocal.
 */
export class Player {
  readonly events = new Emitter<PlayerEvents>();

  #element = new Audio();
  #frame = 0;
  #source: AudioSource | null = null;
  #loop: { start: number; end: number } | null = null;

  constructor() {
    this.#element.preload = 'auto';
    this.#element.addEventListener('ended', () => {
      this.#stopTicking();
      this.events.emit('ended', undefined);
    });
    this.#element.addEventListener('play', () => {
      this.events.emit('play', undefined);
      this.#startTicking();
    });
    this.#element.addEventListener('pause', () => {
      this.#stopTicking();
      this.events.emit('pause', undefined);
    });
  }

  load(source: AudioSource): void {
    this.#source = source;
    this.#element.src = source.objectUrl;
    this.#element.load();
  }

  get source(): AudioSource | null {
    return this.#source;
  }

  get isPlaying(): boolean {
    return !this.#element.paused && !this.#element.ended;
  }

  get currentTime(): number {
    return this.#element.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.#element.duration)
      ? this.#element.duration
      : (this.#source?.durationSec ?? 0);
  }

  get playbackRate(): number {
    return this.#element.playbackRate;
  }

  set playbackRate(rate: number) {
    // preservesPitch keeps a slowed-down vocal singing in the same key, which
    // matters when someone is slowing a passage down to learn its diction.
    this.#element.preservesPitch = true;
    this.#element.playbackRate = Math.min(4, Math.max(0.25, rate));
    this.events.emit('ratechange', this.#element.playbackRate);
  }

  get volume(): number {
    return this.#element.volume;
  }

  set volume(value: number) {
    this.#element.volume = Math.min(1, Math.max(0, value));
  }

  async play(): Promise<void> {
    try {
      await this.#element.play();
    } catch {
      // Autoplay policy rejection — harmless, the user will press play again.
    }
  }

  pause(): void {
    this.#element.pause();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else void this.play();
  }

  seek(seconds: number): void {
    const clamped = Math.min(this.duration || Infinity, Math.max(0, seconds));
    this.#element.currentTime = clamped;
    this.events.emit('seek', clamped);
    this.events.emit('tick', clamped);
  }

  nudge(deltaSeconds: number): void {
    this.seek(this.currentTime + deltaSeconds);
  }

  destroy(): void {
    this.#stopTicking();
    this.#element.pause();
    this.#element.removeAttribute('src');
    this.#element.load();
    this.events.clear();
  }

  // -------------------------------------------------------------------------
  // A–B loop
  //
  // The single most useful tool for learning a fast passage: you cannot learn
  // a line you hear once per playthrough. Enforced on the rAF tick rather than
  // with the element's own `loop`, which only loops the whole file.
  // -------------------------------------------------------------------------

  get loop(): { start: number; end: number } | null {
    return this.#loop;
  }

  setLoop(start: number, end: number): void {
    // Tolerate the points being set in either order — you often find the end
    // of a phrase before you find its beginning.
    const [from, to] = start <= end ? [start, end] : [end, start];
    if (to - from < 0.15) return; // too short to be a phrase; ignore the fumble
    this.#loop = { start: from, end: to };
    this.events.emit('loopchange', this.#loop);
    if (this.currentTime < from || this.currentTime > to) this.seek(from);
  }

  clearLoop(): void {
    this.#loop = null;
    this.events.emit('loopchange', null);
  }

  #startTicking(): void {
    if (this.#frame) return;
    const tick = (): void => {
      const time = this.#element.currentTime;
      if (this.#loop && time >= this.#loop.end) {
        this.#element.currentTime = this.#loop.start;
        this.events.emit('tick', this.#loop.start);
      } else {
        this.events.emit('tick', time);
      }
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stopTicking(): void {
    if (!this.#frame) return;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}
