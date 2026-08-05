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
export class DropzoneView {
  readonly element: HTMLElement;

  #input: HTMLInputElement;
  #onFile: (file: File) => void;

  constructor(onFile: (file: File) => void) {
    this.#onFile = onFile;

    this.#input = el('input', {
      type: 'file',
      class: 'visually-hidden',
      accept: ACCEPT_ATTRIBUTE,
      onchange: (event: Event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) this.#onFile(file);
      },
    }) as HTMLInputElement;

    const button = el(
      'button',
      { class: 'dropzone__button', type: 'button', onclick: () => this.#input.click() },
      svgIcon(ICONS.upload, 'Choose a file'),
      'Choose an audio file',
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
      button,
      this.#input,
      el(
        'p',
        { class: 'dropzone__note' },
        'MP3, WAV, FLAC, M4A, OGG. Transcription runs on your machine by default; nothing is uploaded.',
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
