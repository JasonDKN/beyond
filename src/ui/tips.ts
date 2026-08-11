import { clear, el } from './dom';

/**
 * Hovertips: the app's own tooltips, in the app's own design.
 *
 * The native `title` tooltip is the last piece of Windows chrome left in a
 * dark, typeset interface — grey box, system font, a delay you cannot change,
 * and no way to render a keyboard key as a key. It also cannot be styled at
 * all, which is why every serious interface eventually builds this.
 *
 * An element opts in with `data-tip` instead of `title`. One floating panel is
 * reused for all of them, so a hundred hoverable rows cost one node.
 *
 * Switching hovertips off does not take the text away — it hands it back to
 * the browser by writing `title` on whatever you are pointing at. Losing the
 * explanation entirely would be a worse setting than either style of tooltip.
 */

const STORAGE_KEY = 'beyond.tips';

/** Long enough not to flicker while crossing a row, short enough to feel free. */
const SHOW_DELAY_MS = 320;
/** Distance from the element to the panel. */
const GAP_PX = 8;
/** Keep the panel this far from the window edge. */
const MARGIN_PX = 10;

export type TipSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'key'; readonly text: string };

export interface TipContent {
  /** The first line: what the thing is. */
  readonly title: readonly TipSegment[];
  /** Everything after it: what you can do with it. */
  readonly body: readonly (readonly TipSegment[])[];
}

/**
 * Split a tip into a heading, its lines, and the keys inside them.
 *
 * Backticks mark a keyboard key — `T`, `Shift`, `Ctrl` — so a hint can say
 * "press T" and have T actually look like a key rather than like a capital
 * letter in the middle of a sentence. That is most of the reason to own the
 * tooltip at all.
 */
export function parseTip(raw: string): TipContent {
  const [first = '', ...rest] = raw.split('\n');
  return {
    title: parseSegments(first),
    body: rest.filter((line) => line.trim().length > 0).map(parseSegments),
  };
}

function parseSegments(line: string): TipSegment[] {
  const segments: TipSegment[] = [];
  // Alternating outside/inside backticks; odd indexes are the keys.
  line.split('`').forEach((piece, index) => {
    if (piece === '') return;
    segments.push({ kind: index % 2 === 1 ? 'key' : 'text', text: piece });
  });
  return segments;
}

export function tipsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveTipsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // A preference that cannot be stored is still a preference for this session.
  }
}

export class TipsView {
  readonly element: HTMLElement;

  #titleNode: HTMLElement;
  #bodyNode: HTMLElement;
  #timer = 0;
  #anchor: HTMLElement | null = null;
  #enabled = tipsEnabled();

  constructor() {
    this.#titleNode = el('p', { class: 'tip__title' });
    this.#bodyNode = el('div', { class: 'tip__body' });
    this.element = el(
      'div',
      { class: 'tip', role: 'tooltip', 'aria-hidden': 'true' },
      this.#titleNode,
      this.#bodyNode,
    );

    this.#listen();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    saveTipsEnabled(enabled);
    this.#hide();
    // Turning them back on must strip the native titles handed out while they
    // were off, or both would show at once.
    if (enabled) {
      for (const node of document.querySelectorAll<HTMLElement>('[data-tip][title]')) {
        node.removeAttribute('title');
      }
    }
  }

  #listen(): void {
    // Delegated, so rows rebuilt on every render need no wiring of their own.
    document.addEventListener('pointerover', (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (!anchor || anchor === this.#anchor) return;
      this.#open(anchor);
    });

    document.addEventListener('pointerout', (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (anchor && anchor === this.#anchor) this.#hide();
    });

    // Keyboard users get the same explanation on focus.
    document.addEventListener('focusin', (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (anchor) this.#open(anchor);
    });
    document.addEventListener('focusout', () => this.#hide());

    // Anything that means "I am busy now" dismisses it.
    document.addEventListener('pointerdown', () => this.#hide(), true);

    /*
     * A scroll moves the thing being explained, so the panel follows it.
     *
     * Hiding on any scroll was the obvious first version and it was wrong:
     * the line list glides to centre the next line after every tap, so a tip
     * asked for during that glide was cancelled before it could appear —
     * hovering a row right after timing it looked simply broken. If the
     * pointer really has left, `pointerout` says so.
     */
    window.addEventListener(
      'scroll',
      () => {
        if (this.#anchor && this.element.classList.contains('is-open')) {
          this.#position(this.#anchor);
        }
      },
      true,
    );
    window.addEventListener('blur', () => this.#hide());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#hide();
    });
  }

  #open(anchor: HTMLElement): void {
    const raw = anchor.dataset['tip'];
    if (raw === undefined || raw === '') return;

    if (!this.#enabled) {
      // Hand it to the browser instead, once, at the moment it is needed.
      if (!anchor.hasAttribute('title')) anchor.setAttribute('title', raw);
      return;
    }

    this.#anchor = anchor;
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.#show(anchor, raw), SHOW_DELAY_MS);
  }

  #show(anchor: HTMLElement, raw: string): void {
    // The pointer may have left during the delay.
    if (this.#anchor !== anchor || !anchor.isConnected) return;

    const { title, body } = parseTip(raw);
    this.#titleNode.replaceChildren(...renderSegments(title));
    clear(this.#bodyNode);
    for (const line of body) {
      this.#bodyNode.appendChild(el('p', { class: 'tip__line' }, ...renderSegments(line)));
    }
    this.#bodyNode.classList.toggle('is-empty', body.length === 0);

    this.element.classList.add('is-open');
    this.element.setAttribute('aria-hidden', 'false');
    this.#position(anchor);
  }

  /**
   * Below the thing it explains, centred, flipped up when there is no room.
   *
   * Anchored to the element rather than to the pointer: a panel that follows
   * the mouse is harder to read and jitters on every move, and for a row of
   * lyrics the row is what the text is about.
   */
  #position(anchor: HTMLElement): void {
    const target = anchor.getBoundingClientRect();
    const tip = this.element.getBoundingClientRect();

    let top = target.bottom + GAP_PX;
    if (top + tip.height > window.innerHeight - MARGIN_PX) {
      top = Math.max(MARGIN_PX, target.top - tip.height - GAP_PX);
    }

    const centred = target.left + target.width / 2 - tip.width / 2;
    const left = Math.max(
      MARGIN_PX,
      Math.min(centred, window.innerWidth - tip.width - MARGIN_PX),
    );

    this.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.element.classList.toggle('is-above', top < target.top);
  }

  #hide(): void {
    window.clearTimeout(this.#timer);
    this.#anchor = null;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
  }
}

function renderSegments(segments: readonly TipSegment[]): Node[] {
  return segments.map((segment) =>
    segment.kind === 'key'
      ? el('kbd', { class: 'tip__key' }, segment.text)
      : document.createTextNode(segment.text),
  );
}
