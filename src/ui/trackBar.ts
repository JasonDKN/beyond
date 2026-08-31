import type { State } from '@/core/store';
import { formatWhen } from '@/storage/library';
import { el } from './dom';

/**
 * The track toolbar.
 *
 * Two jobs, both about confidence. It names the song you are working on and
 * says plainly whether that work is on disk — saving was always automatic, but
 * automatic and invisible feels identical to not saving at all when you are
 * about to leave a song you spent an hour timing. And it puts every other
 * track one click away, so switching projects does not mean reloading the page
 * and hunting for a file.
 */

export interface TrackBarCallbacks {
  onToggleLibrary(): void;
  onOpenFile(): void;
  /** Save this track's work to a file on disk. */
  onSaveToFile(): void;
  onSaveAs(): void;
  onToggleHelp(): void;
}

export class TrackBarView {
  readonly element: HTMLElement;

  #title: HTMLElement;
  #save: HTMLElement;
  #tracksButton: HTMLButtonElement;
  #saveFileButton: HTMLButtonElement;
  #saveAsButton: HTMLButtonElement;
  #lastLabel = '';
  /** Name of the project file this track is linked to, if any. */
  #linkedFile: string | null = null;

  constructor(callbacks: TrackBarCallbacks) {
    this.#title = el('span', { class: 'trackbar__title' });
    this.#save = el('span', { class: 'trackbar__save', 'aria-live': 'polite' });

    this.#tracksButton = el(
      'button',
      {
        class: 'trackbar__button',
        type: 'button',
        'data-tip': 'Switch to another saved track',
        onclick: () => callbacks.onToggleLibrary(),
      },
      'Tracks',
    ) as HTMLButtonElement;

    /*
     * Save, and Save As, as two controls rather than one that changes meaning.
     *
     * The single button used to relabel itself once a file was linked, which
     * made the common action — write my work to the file it already lives in —
     * the one you had to read the button to find. Save always saves. Save As
     * always asks where.
     */
    this.#saveFileButton = el(
      'button',
      {
        class: 'trackbar__button trackbar__button--file',
        type: 'button',
        'data-tip': 'Save this track to its file\nIf it has no file yet, this asks for one',
        onclick: () => callbacks.onSaveToFile(),
      },
      'Save',
    ) as HTMLButtonElement;

    this.#saveAsButton = el(
      'button',
      {
        class: 'trackbar__button trackbar__button--saveas',
        type: 'button',
        'data-tip': 'Save this track to a different file\nThe new file becomes the one Save writes to',
        onclick: () => callbacks.onSaveAs(),
      },
      'Save As…',
    ) as HTMLButtonElement;

    this.element = el(
      'div',
      { class: 'trackbar' },
      el('span', { class: 'trackbar__now' }, this.#title, this.#save),
      this.#tracksButton,
      el(
        'button',
        {
          class: 'trackbar__button trackbar__button--new',
          type: 'button',
          'data-tip': 'Open an audio file that is not in your library yet',
          onclick: () => callbacks.onOpenFile(),
        },
        'New song',
      ),
      this.#saveFileButton,
      this.#saveAsButton,
      el(
        'button',
        {
          class: 'trackbar__button trackbar__button--help',
          type: 'button',
          'data-tip': 'Shortcuts, and how the steps fit together\nAlso `?`',
          onclick: () => callbacks.onToggleHelp(),
        },
        'Help',
      ),
    );
  }

  update(state: State): void {
    // Nothing to name until a song is open; the opening screen has its own
    // library and does not need this bar.
    this.element.classList.toggle('is-hidden', state.audio === null);
    if (!state.audio) return;

    const title = state.audio.name.replace(/\.[^.]+$/, '');
    if (title !== this.#lastLabel) {
      this.#title.textContent = title;
      this.#title.title = state.audio.name;
      this.#lastLabel = title;
    }

    this.#save.className = `trackbar__save is-${state.saveState}`;
    this.#save.textContent = this.#linkedFile
      ? `${describeSave(state)} · ${this.#linkedFile}`
      : describeSave(state);
    this.#tracksButton.classList.toggle('is-open', state.libraryOpen);
  }

  /**
   * Show which file this track writes to.
   *
   * Once linked, every later Save goes to that file automatically, and the
   * name appears beside the clock so the work has a visible home.
   */
  setLinkedFile(name: string | null): void {
    this.#linkedFile = name;
    // Save always means the same thing; only its target changes. Save As is a
    // separate control beside it, so neither has to be hunted for.
    this.#saveFileButton.textContent = 'Save';
    this.#saveFileButton.classList.toggle('is-linked', name !== null);
  }
}

/**
 * Wording matters here more than it looks.
 *
 * "Saved" alone invites the question "saved when?", which is the anxiety this
 * is meant to remove — so once a save settles, it says when.
 */
function describeSave(state: State): string {
  switch (state.saveState) {
    case 'saving':
      return 'Saving…';
    case 'failed':
      return 'Not saved — storage unavailable';
    case 'saved':
      return state.savedAt ? `Saved ${formatWhen(state.savedAt)}` : 'Saved';
    default:
      // No edits yet this session. If there is saved work, say so rather than
      // showing nothing, which reads as "nothing is stored".
      return state.trackId ? 'Saved' : '';
  }
}
