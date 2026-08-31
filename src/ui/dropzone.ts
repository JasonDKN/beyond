import { ACCEPT_ATTRIBUTE } from '@/audio/decoder';
import type { State } from '@/core/store';
import { el, ICONS, svgIcon } from './dom';

/**
 * The opening screen.
 *
 * The first thing anyone sees, so it carries the idea: a lyric line dissolving
 * into its own phonetic transcription. The animation is CSS; this file just
 * puts the two strings next to each other and handles the file.
 */
export interface DropzoneCallbacks {
  onFile(file: File): void;
  /** A save file, brought over from another device. */
  onProjectFile(file: File): void;
}

export class DropzoneView {
  readonly element: HTMLElement;

  #input: HTMLInputElement;
  #projectInput: HTMLInputElement;
  #onFile: (file: File) => void;

  constructor(callbacks: DropzoneCallbacks) {
    this.#onFile = callbacks.onFile;

    this.#input = el('input', {
      type: 'file',
      class: 'visually-hidden',
      accept: ACCEPT_ATTRIBUTE,
      onchange: (event: Event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) this.#onFile(file);
      },
    }) as HTMLInputElement;

    /*
     * The other way in, and for a while the missing one.
     *
     * Arriving on a device that has never seen this app — a phone, on a trip —
     * the only thing on screen was "choose an audio file", which is not what
     * you have. You have a save file: one file holding a song and a fortnight of
     * work on it. There was no button for that anywhere on the opening screen,
     * because the one that existed lived in the track drawer, and the track
     * drawer only opens once a song is already loaded. A door on the inside of
     * a locked room.
     *
     * No `accept` filter on purpose. A save file ends in `.json`, but file
     * pickers on phones are inconsistent about honouring extension filters,
     * and a greyed-out file you cannot select is indistinguishable from a
     * broken app. Anything picked that is not a save file says so plainly.
     */
    this.#projectInput = el('input', {
      type: 'file',
      class: 'visually-hidden',
      'data-role': 'open-save',
      onchange: (event: Event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (file) callbacks.onProjectFile(file);
      },
    }) as HTMLInputElement;

    const button = el(
      'button',
      { class: 'dropzone__button', type: 'button', onclick: () => this.#input.click() },
      svgIcon(ICONS.upload, 'Choose a file'),
      'Choose an audio file',
    );

    const openSave = el(
      'button',
      {
        class: 'dropzone__button dropzone__button--save',
        type: 'button',
        'data-tip':
          'Open a save file made anywhere\nOne file holding the song, its lyrics and all your timings',
        onclick: () => this.#projectInput.click(),
      },
      'Open a save file',
    );

    this.element = el(
      'div',
      { class: 'dropzone' },
      el(
        'div',
        { class: 'dropzone__art', 'aria-hidden': 'true' },
        el('span', { class: 'dropzone__line dropzone__line--text' }, 'beyond the words'),
        el(
          'span',
          { class: 'dropzone__line dropzone__line--ipa', lang: 'und-fonipa' },
          'bɪˈjɑnd ðə wɝdz',
        ),
      ),
      el('h1', { class: 'dropzone__title' }, 'Drop a song in'),
      el(
        'p',
        { class: 'dropzone__body' },
        'Beyond listens, finds the words, and writes each one in the International Phonetic Alphabet — then lays them across the waveform where they were sung.',
      ),
      el('div', { class: 'dropzone__actions' }, button, openSave),
      this.#input,
      this.#projectInput,
      el(
        'p',
        { class: 'dropzone__note' },
        'MP3, WAV, FLAC, M4A, OGG. Or open a save file from another device — it brings the song and your work with it. Everything runs on your machine; nothing is uploaded.',
      ),
    );

    this.#bindDragAndDrop();
  }

  update(state: State): void {
    this.element.classList.toggle('is-hidden', Boolean(state.audio));
  }

  #bindDragAndDrop(): void {
    const target = document.body;
    let depth = 0;

    const setDragging = (dragging: boolean): void => {
      this.element.classList.toggle('is-dragging', dragging);
    };

    target.addEventListener('dragenter', (event) => {
      event.preventDefault();
      depth += 1;
      setDragging(true);
    });
    target.addEventListener('dragover', (event) => event.preventDefault());
    target.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    });
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) this.#onFile(file);
    });
  }
}
