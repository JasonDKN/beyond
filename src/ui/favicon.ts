/**
 * The mark in the tab, and what it does while a song is playing.
 *
 * A browser with nine tabs open and one of them making noise is a familiar
 * small annoyance, and the tab strip is exactly where you look to solve it. So
 * Beyond's tab answers: the schwa sits mint-on-ink at rest and flips to
 * ink-on-mint while audio runs. At sixteen pixels you cannot read a label, but
 * you can absolutely see which square went bright.
 *
 * Drawn as inline SVG data URIs rather than as two more PNGs in `public/`,
 * because a favicon that has to be fetched is a favicon that arrives late — and
 * this one changes on every play and pause, which is not something to spend
 * network requests on.
 */

/** Both faces of the mark, at the one size a tab ever shows. */
function mark(tile: string, glyph: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
    `<rect width='32' height='32' rx='7' fill='${tile}'/>` +
    `<text x='16' y='17' font-size='23' text-anchor='middle' dominant-baseline='central'` +
    ` fill='${glyph}' font-family='system-ui,sans-serif'>ə</text>` +
    `</svg>`;
  // Encoded by hand rather than with encodeURIComponent, which escapes far more
  // than a data URI needs and turns a readable string into line noise.
  return 'data:image/svg+xml,' + svg.replace(/[<>#"]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
}

const RESTING = mark('#06070f', '#7cf5d5');
const PLAYING = mark('#7cf5d5', '#06070f');

let showing: boolean | null = null;

/**
 * Point the tab at the right face.
 *
 * Called on every render, so it does nothing at all unless the state actually
 * changed — rewriting an href on every tick would have the browser re-decode
 * the image endlessly for no visible difference.
 */
export function setFaviconPlaying(playing: boolean): void {
  if (playing === showing) return;
  showing = playing;

  /*
   * By id, deliberately.
   *
   * There are two `rel="icon"` links in the page — a PNG for anything that
   * wants a bitmap, and the inline mark after it. The browser uses the last
   * one; `querySelector` returns the first. Selecting by rel would have
   * rewritten the one nobody looks at, and the tab would never have changed.
   */
  const link = document.getElementById('favicon');
  if (link instanceof HTMLLinkElement) link.href = playing ? PLAYING : RESTING;
}
