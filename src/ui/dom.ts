/** Tiny DOM helpers. Not a framework — just the three lines everyone rewrites. */

type Attributes = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** The one namespace every SVG element in here has to be created in. */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgIcon(path: string, label: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  svg.appendChild(shape);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
  svg.appendChild(title);
  return svg;
}

/**
 * A circular arrow with the number of seconds written inside it.
 *
 * Two chevrons say "go backwards" and nothing about how far; this says both,
 * and it is the shape every video player has taught people to read. The arc
 * runs the long way round with the head at the top, so the direction is
 * legible at the size the button actually is.
 */
export function seekIcon(seconds: number, back: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', 'icon--seek');

  const r = 8;
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const at = (deg: number): [number, number] => [
    12 + r * Math.cos(rad(deg)),
    12 - r * Math.sin(rad(deg)),
  ];

  // Start and finish chosen so the gap sits low and the head sits high, where
  // it reads; the sweep flag turns the whole thing round for the other way.
  const [sx, sy] = at(back ? -20 : 200);
  const [ex, ey] = at(back ? 130 : 50);
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute(
    'd',
    `M${sx.toFixed(2)} ${sy.toFixed(2)}A${r} ${r} 0 1 ${back ? 0 : 1} ${ex.toFixed(2)} ${ey.toFixed(2)}`,
  );
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'currentColor');
  arc.setAttribute('stroke-width', '1.8');
  arc.setAttribute('stroke-linecap', 'round');

  // The head, pointing along the direction of travel at the end of the arc.
  const t = rad(back ? 130 : 50);
  const dir: [number, number] = back
    ? [-Math.sin(t), -Math.cos(t)]
    : [Math.sin(t), Math.cos(t)];
  const perp: [number, number] = [-dir[1], dir[0]];
  const point = (dx: number, dy: number): string =>
    `${(ex + dx).toFixed(2)} ${(ey + dy).toFixed(2)}`;
  const head = document.createElementNS(SVG_NS, 'path');
  head.setAttribute(
    'd',
    `M${point(dir[0] * 4.2, dir[1] * 4.2)}L${point(perp[0] * 2.9, perp[1] * 2.9)}L${point(
      -perp[0] * 2.9,
      -perp[1] * 2.9,
    )}Z`,
  );
  head.setAttribute('fill', 'currentColor');

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', '12');
  label.setAttribute('y', '12.4');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'central');
  label.setAttribute('font-size', '10');
  label.setAttribute('font-weight', '600');
  label.setAttribute('fill', 'currentColor');
  label.textContent = String(seconds);

  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${back ? 'Back' : 'Forward'} ${seconds} seconds`;

  svg.append(arc, head, label, title);
  return svg;
}

export const ICONS = {
  /*
   * The play triangle, centred on the button rather than beside it.
   *
   * It used to span x 8→19, putting its bounding box at 13.5 in a 24-wide
   * box — a pixel and a half right of centre, while the pause bars sat exactly
   * on 12. Symmetrical glyphs look centred when they are; a triangle does not,
   * because its mass tapers away to a point, so it wants a small nudge right.
   * A small one. The old offset was large enough that the glyph visibly jumped
   * sideways every time you pressed the button.
   *
   * Now 7.35→17.85, a centre of 12.6: still optically offset, no longer
   * noticeably so, and the same width as before so the weight is unchanged.
   */
  play: 'M7.35 5.25v13.5L17.85 12z',
  pause: 'M7 5h3.5v14H7zm6.5 0H17v14h-3.5z',
  back: 'M11 6v12L2.5 12zM21 6v12l-8.5-6z',
  forward: 'M13 6v12l8.5-6zM3 6v12l8.5-6z',
  download: 'M12 3v10m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 20V9m0 0 4 4m-4-4-4 4M4 5h16',
} as const;

/** `3:04` — the only time format anyone wants next to a waveform. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
