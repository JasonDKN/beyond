import type { State } from '@/core/store';
import type { PhoneticWord } from '@/core/types';
import { wordVowelHeight } from '@/phonetics/vowelspace';

/**
 * The Living Waveform Staff.
 *
 * The central conceit of Beyond: a waveform and a musical staff are the same
 * drawing seen twice. Five staff lines are ruled across the audio, and every
 * word is placed on them as a notehead — but its vertical position is not
 * pitch. It is *vowel height*: [i] sits at the top of the staff, [ɑ] at the
 * bottom, exactly where they sit on the IPA vowel chart.
 *
 * So the line traced through the noteheads is the melody of the mouth. Two
 * notation systems, one picture — which is the whole reason this app exists.
 */

export interface StaffCallbacks {
  onSeek(seconds: number): void;
  onSelectWord(lineIndex: number, wordIndex: number): void;
}

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly word: PhoneticWord;
  readonly lineIndex: number;
  readonly wordIndex: number;
}

const STAFF_LINES = 5;

/** How far ahead of a target its ring starts closing. */
const APPROACH_SEC = 1.7;
/** …and how long the flash lasts after it lands. */
const LANDED_SEC = 0.3;
/** Ring size at its widest, and the target it collapses onto. */
const RING_RADIUS = 26;
const DOT_RADIUS = 4.5;

export class StaffView {
  readonly element: HTMLCanvasElement;

  #context: CanvasRenderingContext2D;
  #callbacks: StaffCallbacks;
  #state: State | null = null;
  #dpr = 1;
  #width = 0;
  #height = 0;
  #placed: Placed[] = [];
  #hover: Placed | null = null;
  #pointerX: number | null = null;

  /** 1 = the whole song fits; higher zooms in and follows the playhead. */
  #zoom = 1;

  constructor(callbacks: StaffCallbacks) {
    this.#callbacks = callbacks;
    this.element = document.createElement('canvas');
    this.element.className = 'staff';
    this.element.setAttribute('role', 'slider');
    this.element.setAttribute('aria-label', 'Waveform and phonetic staff. Click to seek.');
    this.element.tabIndex = 0;

    const context = this.element.getContext('2d');
    if (!context) throw new Error('This browser cannot create a 2D canvas context.');
    this.#context = context;

    this.#bindEvents();
  }

  setZoom(zoom: number): void {
    this.#zoom = Math.min(24, Math.max(1, zoom));
    this.render();
  }

  get zoom(): number {
    return this.#zoom;
  }

  resize(): void {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.#dpr = Math.min(2, window.devicePixelRatio || 1);
    this.#width = rect.width;
    this.#height = rect.height;
    this.element.width = Math.round(rect.width * this.#dpr);
    this.element.height = Math.round(rect.height * this.#dpr);
    this.#context.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    this.render();
  }

  update(state: State): void {
    this.#state = state;
    this.render();
  }

  // -------------------------------------------------------------------------
  // Time ↔ pixel mapping
  // -------------------------------------------------------------------------

  #duration(): number {
    return this.#state?.audio?.durationSec ?? 0;
  }

  /** The slice of the song currently on screen. */
  #window(): { start: number; span: number } {
    const duration = this.#duration();
    const span = duration / this.#zoom;
    if (this.#zoom === 1) return { start: 0, span: duration };
    const centre = this.#state?.currentTime ?? 0;
    const start = Math.min(Math.max(0, centre - span / 2), Math.max(0, duration - span));
    return { start, span };
  }

  #timeToX(seconds: number): number {
    const { start, span } = this.#window();
    if (span <= 0) return 0;
    return ((seconds - start) / span) * this.#width;
  }

  #xToTime(x: number): number {
    const { start, span } = this.#window();
    return start + (x / this.#width) * span;
  }

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  render(): void {
    const ctx = this.#context;
    if (this.#width === 0 || this.#height === 0) return;

    ctx.clearRect(0, 0, this.#width, this.#height);
    this.#paintBackdrop();

    if (!this.#state?.envelope) {
      this.#paintEmpty();
      return;
    }

    this.#paintWaveform();
    this.#paintStaffLines();
    this.#paintOnsets();
    this.#paintApproach();
    this.#placed = this.#layoutWords();
    this.#paintVowelContour();
    this.#paintNoteheads();
    this.#paintPlayhead();
    this.#paintCursor();
  }

  #paintBackdrop(): void {
    const ctx = this.#context;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.#height);
    gradient.addColorStop(0, 'rgba(15, 20, 44, 0.85)');
    gradient.addColorStop(0.5, 'rgba(9, 12, 28, 0.95)');
    gradient.addColorStop(1, 'rgba(6, 8, 20, 1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.#width, this.#height);
  }

  #paintEmpty(): void {
    const ctx = this.#context;
    const mid = this.#height / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(160, 178, 224, 0.13)';
    ctx.lineWidth = 1;
    for (let i = 0; i < STAFF_LINES; i += 1) {
      const y = mid + (i - (STAFF_LINES - 1) / 2) * (this.#height * 0.08);
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(this.#width - 24, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Staff area: the upper band the noteheads live in.
   *
   * Kept clear of the waveform ribbon below it — an IPA glyph sitting on top of
   * a transient is unreadable, and the two layers need to read as staff *over*
   * audio rather than as one muddled drawing.
   */
  #staffBand(): { top: number; bottom: number; height: number } {
    const top = this.#height * 0.13;
    const bottom = this.#height * 0.6;
    return { top, bottom, height: bottom - top };
  }

  #paintStaffLines(): void {
    const ctx = this.#context;
    const { top, height } = this.#staffBand();
    ctx.save();
    for (let i = 0; i < STAFF_LINES; i += 1) {
      const y = Math.round(top + (height * i) / (STAFF_LINES - 1)) + 0.5;
      const isCentre = i === Math.floor(STAFF_LINES / 2);
      ctx.strokeStyle = isCentre ? 'rgba(168, 190, 255, 0.22)' : 'rgba(150, 170, 230, 0.11)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.#width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  #paintWaveform(): void {
    const state = this.#state;
    const envelope = state?.envelope;
    if (!envelope || !state) return;

    const ctx = this.#context;
    const duration = this.#duration();
    const { start, span } = this.#window();
    const centreY = this.#height * 0.82;
    const amplitude = this.#height * 0.15;

    const bucketFor = (time: number): number =>
      Math.round((time / Math.max(duration, 1e-6)) * (envelope.length - 1));

    const firstBucket = Math.max(0, bucketFor(start));
    const lastBucket = Math.min(envelope.length - 1, bucketFor(start + span));
    const bucketCount = Math.max(1, lastBucket - firstBucket);
    const step = Math.max(1, Math.floor(bucketCount / Math.max(1, this.#width)));

    const gradient = ctx.createLinearGradient(0, centreY - amplitude, 0, centreY + amplitude);
    gradient.addColorStop(0, 'rgba(124, 245, 213, 0.75)');
    gradient.addColorStop(0.5, 'rgba(140, 190, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(179, 140, 255, 0.7)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, centreY);

    // Upper edge, left to right…
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += step) {
      const x = ((bucket - firstBucket) / bucketCount) * this.#width;
      const max = envelope.peaks[bucket * 2 + 1] ?? 0;
      ctx.lineTo(x, centreY - Math.abs(max) * amplitude);
    }
    // …then the lower edge back again, closing one filled ribbon.
    for (let bucket = lastBucket; bucket >= firstBucket; bucket -= step) {
      const x = ((bucket - firstBucket) / bucketCount) * this.#width;
      const min = envelope.peaks[bucket * 2] ?? 0;
      ctx.lineTo(x, centreY + Math.abs(min) * amplitude);
    }

    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fill();

    // A brighter mirror line through the middle gives the ribbon a spine.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centreY);
    ctx.lineTo(this.#width, centreY);
    ctx.stroke();
    ctx.restore();
  }

  #paintOnsets(): void {
    const state = this.#state;
    if (!state) return;
    const ctx = this.#context;
    const { start, span } = this.#window();
    const y = this.#height * 0.975;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 184, 107, 0.35)';
    ctx.lineWidth = 1;
    for (const onset of state.onsets) {
      if (onset < start || onset > start + span) continue;
      const x = Math.round(this.#timeToX(onset)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Rings closing on what is about to arrive.
   *
   * Tapping is a reaction, and a reaction to sound alone is always a little
   * late — you hear the vocal start, then move. A ring that shrinks onto its
   * moment turns that into something you can anticipate instead, the way a
   * rhythm game does: by the time it closes, your hand is already going.
   *
   * Two kinds of target, told apart by colour, because they are different
   * claims about the song:
   *
   *   Mint — a time you tapped yourself. Certain. On a second pass these are
   *   your own marks coming back at you, which is how you check them.
   *
   *   Amber — a transient the analysis found. A guess, and drawn like one, in
   *   the same colour as the tick marks it belongs to. On a first pass, when
   *   nothing has been tapped yet, these are the only warning available and
   *   the reason this helps at all.
   *
   * Only the next second and a half, and only a handful at once. A ring for
   * every transient in the song would be a wall of circles and no help to
   * anybody.
   */
  #paintApproach(): void {
    const state = this.#state;
    if (!state) return;
    const timing = state.mode === 'beatmap';
    if (!timing && state.mode !== 'learning') return;

    const now = state.currentTime;
    const { start, span } = this.#window();
    const band = this.#staffBand();
    const y = band.top + band.height * 0.62;
    const ctx = this.#context;

    const targets: { at: number; mine: boolean }[] = [];
    for (const line of state.score?.lines ?? []) targets.push({ at: line.startSec, mine: true });
    /*
     * The amber guesses belong to timing, not to reading.
     *
     * In Beatmap a detected transient is the only warning available before you
     * have tapped anything, which is the whole reason it is drawn. In Learning
     * everything already has a time, so a second opinion about where a drum hit
     * was adds nothing and takes attention from the words — which are what you
     * are here for. What is left is the arrival of the next line, which is
     * exactly what the score below is asking you to prepare for.
     */
    if (timing) for (const onset of state.onsets) targets.push({ at: onset, mine: false });

    const soon = targets
      .filter(
        (target) =>
          target.at > now - LANDED_SEC &&
          target.at < now + APPROACH_SEC &&
          target.at >= start &&
          target.at <= start + span,
      )
      .sort((a, b) => a.at - b.at)
      .slice(0, 5);
    if (soon.length === 0) return;

    ctx.save();
    /*
     * Zoomed out, a second and a half of song is a couple of pixels wide, and
     * every ring in the lookahead lands on the same spot — five circles drawn
     * on top of each other, which reads as a smudge rather than as anything
     * approaching. Keeping them a ring's width apart means the nearest target
     * is always the one you see, at any zoom.
     */
    let lastX = Number.NEGATIVE_INFINITY;
    for (const target of soon) {
      const x = this.#timeToX(target.at);
      if (x - lastX < RING_RADIUS * 0.6) continue;
      lastX = x;
      const lead = target.at - now;
      const colour = target.mine ? '124, 245, 213' : '255, 184, 107';
      ctx.strokeStyle = `rgba(${colour}, 1)`;
      ctx.fillStyle = `rgba(${colour}, 1)`;

      if (lead >= 0) {
        // Closing. Wide and faint when far off, tight and bright on arrival.
        const near = 1 - lead / APPROACH_SEC;
        ctx.globalAlpha = (0.1 + near * 0.65) * (target.mine ? 1 : 0.7);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS + (RING_RADIUS - DOT_RADIUS) * (1 - near), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Landed. One quick ring outward, then gone.
        const gone = Math.min(1, -lead / LANDED_SEC);
        ctx.globalAlpha = (1 - gone) * 0.75;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS + gone * 20, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = lead >= 0 ? 0.45 : 0.85;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Place every visible word on the staff by the height of its stressed vowel. */
  #layoutWords(): Placed[] {
    const state = this.#state;
    if (!state?.score) return [];
    const { start, span } = this.#window();
    const { top, height } = this.#staffBand();
    const placed: Placed[] = [];

    state.score.lines.forEach((line, lineIndex) => {
      if (line.endSec < start || line.startSec > start + span) return;
      line.words.forEach((word, wordIndex) => {
        const centre = (word.startSec + word.endSec) / 2;
        if (centre < start - 0.5 || centre > start + span + 0.5) return;
        // height 1 = close vowel [i] → top of the staff; 0 = open [ɑ] → bottom.
        const y = top + (1 - wordVowelHeight(word)) * height;
        placed.push({ x: this.#timeToX(centre), y, word, lineIndex, wordIndex });
      });
    });

    return placed;
  }

  /** The contour through the vowels — the mouth's melody. */
  #paintVowelContour(): void {
    if (this.#placed.length < 2) return;
    const ctx = this.#context;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.#placed[0]!.x, this.#placed[0]!.y);
    for (let i = 1; i < this.#placed.length; i += 1) {
      const previous = this.#placed[i - 1]!;
      const current = this.#placed[i]!;
      // Catmull-Rom-ish smoothing: control points at the horizontal midpoint
      // keep the curve from overshooting on big vowel leaps.
      const midX = (previous.x + current.x) / 2;
      ctx.bezierCurveTo(midX, previous.y, midX, current.y, current.x, current.y);
    }
    const gradient = ctx.createLinearGradient(0, 0, this.#width, 0);
    gradient.addColorStop(0, 'rgba(124, 245, 213, 0.45)');
    gradient.addColorStop(1, 'rgba(179, 140, 255, 0.45)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  #paintNoteheads(): void {
    const state = this.#state;
    if (!state) return;
    const ctx = this.#context;
    const time = state.currentTime;
    const dense = this.#placed.length > this.#width / 26;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of this.#placed) {
      const { word } = item;
      const isActive = time >= word.startSec && time <= word.endSec;
      const isSelected =
        state.selected?.lineIndex === item.lineIndex && state.selected.wordIndex === item.wordIndex;
      const isHovered = this.#hover === item;
      const uncertain = word.confidence < 0.6;

      // Glow behind the active word: the note being sung, right now.
      if (isActive) {
        const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, 26);
        glow.addColorStop(0, 'rgba(124, 245, 213, 0.55)');
        glow.addColorStop(1, 'rgba(124, 245, 213, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 26, 0, Math.PI * 2);
        ctx.fill();
      }

      const radius = isActive ? 5.5 : isSelected || isHovered ? 5 : 3.4;
      ctx.beginPath();
      ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isActive
        ? '#eafff8'
        : uncertain
          ? 'rgba(255, 184, 107, 0.8)'
          : 'rgba(178, 202, 255, 0.8)';
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = 'rgba(179, 140, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(item.x, item.y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Only letter the staff when there is room; a crowded staff is unreadable.
      if (!dense || isActive || isHovered) {
        ctx.font = `${isActive ? 15 : 13}px "Doulos SCS", "Charis SIL", "Gentium Plus", "Segoe UI", serif`;
        ctx.fillStyle = isActive ? 'rgba(234, 255, 248, 0.95)' : 'rgba(196, 214, 255, 0.6)';
        ctx.fillText(word.ipa, item.x, item.y - 15);
      }
    }
    ctx.restore();
  }

  #paintPlayhead(): void {
    const state = this.#state;
    if (!state?.audio) return;
    const ctx = this.#context;
    const x = Math.round(this.#timeToX(state.currentTime)) + 0.5;
    if (x < -2 || x > this.#width + 2) return;

    ctx.save();
    const bloom = ctx.createLinearGradient(x - 22, 0, x + 22, 0);
    bloom.addColorStop(0, 'rgba(124, 245, 213, 0)');
    bloom.addColorStop(0.5, 'rgba(124, 245, 213, 0.16)');
    bloom.addColorStop(1, 'rgba(124, 245, 213, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(x - 22, 0, 44, this.#height);

    ctx.strokeStyle = 'rgba(224, 255, 246, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.#height);
    ctx.stroke();
    ctx.restore();
  }

  #paintCursor(): void {
    if (this.#pointerX === null) return;
    const ctx = this.#context;
    const x = Math.round(this.#pointerX) + 0.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(179, 140, 255, 0.35)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.#height);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  #bindEvents(): void {
    const localX = (event: PointerEvent | MouseEvent): number =>
      event.clientX - this.element.getBoundingClientRect().left;

    this.element.addEventListener('pointermove', (event) => {
      const x = localX(event);
      this.#pointerX = x;
      const y = event.clientY - this.element.getBoundingClientRect().top;
      this.#hover = this.#hitTest(x, y);
      this.element.style.cursor = this.#hover ? 'pointer' : 'crosshair';
      this.render();
    });

    this.element.addEventListener('pointerleave', () => {
      this.#pointerX = null;
      this.#hover = null;
      this.render();
    });

    this.element.addEventListener('pointerdown', (event) => {
      const x = localX(event);
      const y = event.clientY - this.element.getBoundingClientRect().top;
      const hit = this.#hitTest(x, y);
      if (hit) {
        this.#callbacks.onSelectWord(hit.lineIndex, hit.wordIndex);
        this.#callbacks.onSeek(hit.word.startSec);
      } else {
        this.#callbacks.onSeek(this.#xToTime(x));
      }
    });

    this.element.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        this.setZoom(this.#zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
      },
      { passive: false },
    );

    this.element.addEventListener('keydown', (event) => {
      const time = this.#state?.currentTime ?? 0;
      if (event.key === 'ArrowRight') this.#callbacks.onSeek(time + (event.shiftKey ? 5 : 1));
      else if (event.key === 'ArrowLeft') this.#callbacks.onSeek(time - (event.shiftKey ? 5 : 1));
      else return;
      event.preventDefault();
    });
  }

  #hitTest(x: number, y: number): Placed | null {
    let closest: Placed | null = null;
    let bestDistance = 18;
    for (const item of this.#placed) {
      const distance = Math.hypot(item.x - x, item.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = item;
      }
    }
    return closest;
  }
}
