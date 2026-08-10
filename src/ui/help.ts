import type { State } from '@/core/store';
import { el } from './dom';

/**
 * The shortcuts, written down.
 *
 * Everything here is discoverable by hovering the thing it applies to, but
 * hover only helps once you know something is there. This is the list you read
 * once and then rarely need again.
 */

interface Shortcut {
  readonly keys: readonly string[];
  readonly what: string;
}

interface Group {
  readonly title: string;
  readonly note?: string;
  readonly items: readonly Shortcut[];
}

const GROUPS: readonly Group[] = [
  {
    title: 'Timing lines — Annotation',
    note: 'Aim first, then tap. The armed line is the one with the mint edge.',
    items: [
      { keys: ['Click a line'], what: 'Aim the next tap at it, without moving the playhead' },
      { keys: ['↑', '↓'], what: 'Move that aim up or down the sheet' },
      { keys: ['T'], what: 'Time the armed line at the playhead — the same key as the first pass' },
      { keys: ['R'], what: 'Rewind 2.5s into the armed line and play, so it arrives at you' },
      { keys: ['Backspace'], what: 'Clear just that line’s timing, leaving the rest alone' },
    ],
  },
  {
    title: 'Playback',
    items: [
      { keys: ['Space'], what: 'Play or pause' },
      { keys: ['←', '→'], what: 'Nudge 3 seconds; hold Shift for 10' },
      { keys: ['['], what: 'Set the loop start here' },
      { keys: [']'], what: 'Set the loop end and start looping' },
      { keys: ['\\'], what: 'Clear the loop' },
    ],
  },
  {
    title: 'Sections — Compartmentalize',
    note: 'Nothing is detected. You say what the parts are, and where each one happens.',
    items: [
      { keys: ['+ Add section'], what: 'Make a part — verse, hook, bridge. Name it and pick its kind' },
      { keys: ['Click a line'], what: 'Select it · Shift for a run · Ctrl or ⌘ to add one' },
      { keys: ['Drag'], what: 'Carry the selected lines into a section, or back out below the list' },
      {
        keys: ['+ Add where it happens'],
        what: 'Place the part on the timeline; the first one offers the moment you tapped',
      },
      {
        keys: ['＋ It repeats here'],
        what: 'Mark a return — its lines replay shifted, so you tap a hook once however often it comes back',
      },
      { keys: ['⤓'], what: 'Set that start or end to the playhead. Or type the time: 1:23' },
    ],
  },
  {
    title: 'Artists',
    note: 'A section carries a default; any line can override it.',
    items: [
      { keys: ['+ Add artist'], what: 'Add each singer once, then tag with the dropdowns' },
      { keys: ['Whole section'], what: 'Give every line in the part to one artist' },
      { keys: ['Per line'], what: 'Override a single line, for a verse that trades between members' },
    ],
  },
  {
    title: 'The section strip',
    items: [
      { keys: ['Click a block'], what: 'Play from the start of that part' },
      { keys: ['Shift-click'], what: 'Loop that part, for drilling one passage' },
      { keys: ['↺'], what: 'Marks a repeat rather than the performance you tapped' },
    ],
  },
  {
    title: 'Elsewhere',
    items: [
      { keys: ['Esc'], what: 'Close the track drawer, or clear the selected word' },
      { keys: ['Ctrl', 'scroll'], what: 'Zoom the waveform' },
    ],
  },
];

export class HelpView {
  readonly element: HTMLElement;
  #open = false;

  constructor(onClose: () => void) {
    this.element = el(
      'div',
      {
        class: 'help is-hidden',
        role: 'dialog',
        'aria-label': 'Keyboard shortcuts',
        // Clicking the backdrop dismisses; clicking the card does not.
        onclick: (event: Event) => {
          if (event.target === this.element) onClose();
        },
      },
      el(
        'section',
        { class: 'help__card' },
        el(
          'header',
          { class: 'help__head' },
          el('h2', { class: 'help__title' }, 'Shortcuts'),
          el(
            'button',
            { class: 'help__close', type: 'button', 'aria-label': 'Close', onclick: onClose },
            '✕',
          ),
        ),
        el('div', { class: 'help__groups' }, ...GROUPS.map(renderGroup)),
      ),
    );
  }

  setOpen(open: boolean): void {
    this.#open = open;
    this.element.classList.toggle('is-hidden', !open);
  }

  get isOpen(): boolean {
    return this.#open;
  }

  update(_state: State): void {
    /* Nothing to react to — the shortcuts do not change. */
  }
}

function renderGroup(group: Group): HTMLElement {
  return el(
    'div',
    { class: 'help__group' },
    el('h3', { class: 'help__group-title' }, group.title),
    group.note ? el('p', { class: 'help__note' }, group.note) : null,
    el(
      'dl',
      { class: 'help__list' },
      ...group.items.flatMap((item) => [
        el('dt', { class: 'help__keys' }, ...item.keys.map((key) => el('kbd', {}, key))),
        el('dd', { class: 'help__what' }, item.what),
      ]),
    ),
  );
}
