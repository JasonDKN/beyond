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
}

export class TrackBarView {
  readonly element: HTMLElement;

  #title: HTMLElement;
  #save: HTMLElement;
  #tracksButton: HTMLButtonElement;
  #lastLabel = '';

  constructor(callbacks: TrackBarCallbacks) {
    this.#title = el('span', { class: 'trackbar__title' });
    this.#save = el('span', { class: 'trackbar__save', 'aria-live': 'polite' });

    this.#tracksButton = el(
      'button',
      {
        class: 'trackbar__button',
        type: 'button',
        title: 'Switch to another saved track',
        onclick: () => callbacks.onToggleLibrary(),
      },
      'Tracks',
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
          title: 'Open an audio file that is not in your library yet',
          onclick: () => callbacks.onOpenFile(),
        },
        'New song',
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
    this.#save.textContent = describeSave(state);
    this.#tracksButton.classList.toggle('is-open', state.libraryOpen);
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
