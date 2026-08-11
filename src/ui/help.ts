import type { State } from '@/core/store';
import { el } from './dom';
import type { TipsView } from './tips';

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
    title: 'Timing lines — Beatmap',
    note: 'Paste the words in Setup, then map them here. Aim first, then tap — the armed line is the one with the mint edge.',
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
    title: 'Parts of the song',
    note: 'Keep the headings in the lyrics you paste — [Intro: j-hope], [Pre-Chorus: V, Jimin] — and each part becomes a button under the waveform once its lines are timed.',
    items: [
      { keys: ['Click a part'], what: 'Play from the start of it' },
      { keys: ['Shift-click'], what: 'Loop that part, for drilling one passage' },
      { keys: ['Hover'], what: 'See its times and who the heading credits' },
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

  constructor(onClose: () => void, tips: TipsView) {
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
            {
              class: 'help__close',
              type: 'button',
              'aria-label': 'Close',
              'data-tip': 'Close this panel\nOr press `Esc`',
              onclick: onClose,
            },
            '✕',
          ),
        ),
        settingRow(tips),
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

/**
 * The one setting Beyond has, kept where you go to learn the interface.
 *
 * Turning hovertips off does not silence them — it hands them back to the
 * browser as ordinary `title` tooltips. Somebody who dislikes the styled panel
 * still gets the explanation, in the shape their operating system draws.
 */
function settingRow(tips: TipsView): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': 'Styled hovertips',
    onchange: (event: Event) => tips.setEnabled((event.target as HTMLInputElement).checked),
  }) as HTMLInputElement;
  input.checked = tips.enabled;

  return el(
    'div',
    { class: 'help__setting' },
    el(
      'div',
      { class: 'help__setting-text' },
      el('span', { class: 'help__setting-name' }, 'Hovertips'),
      el(
        'p',
        { class: 'help__setting-note' },
        'Explanations drawn in Beyond’s own style, with real keys. Turn this off to use your system’s plain tooltips instead.',
      ),
    ),
    el('label', { class: 'switch' }, input, el('span', { class: 'switch__knob' })),
  );
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
