import type { State } from '@/core/store';
import { el } from './dom';

/**
 * The status strip.
 *
 * Local Whisper on a laptop CPU can take a minute per minute of audio. A
 * progress bar that says what it is actually doing — downloading, warming up,
 * listening, phonemizing — is the difference between "slow" and "broken".
 */
export class StatusView {
  readonly element: HTMLElement;

  #bar: HTMLElement;
  #message: HTMLElement;
  #detail: HTMLElement;

  constructor() {
    this.#bar = el('div', { class: 'status__bar' });
    this.#message = el('span', { class: 'status__message' });
    this.#detail = el('span', { class: 'status__detail' });
    this.element = el(
      'footer',
      { class: 'status', role: 'status', 'aria-live': 'polite' },
      el('div', { class: 'status__track' }, this.#bar),
      el('div', { class: 'status__text' }, this.#message, this.#detail),
    );
  }

  update(state: State): void {
    this.element.dataset['status'] = state.status;

    if (state.status === 'error') {
      this.#bar.style.width = '100%';
      this.#message.textContent = state.error ?? 'Something went wrong.';
      this.#detail.textContent = '';
      return;
    }

    if (state.progress) {
      const ratio = state.progress.ratio;
      this.#bar.style.width = ratio === null ? '100%' : `${Math.round(ratio * 100)}%`;
      this.#bar.classList.toggle('is-indeterminate', ratio === null);
      this.#message.textContent = state.progress.message;
      this.#detail.textContent = STAGE_LABELS[state.progress.stage] ?? '';
      return;
    }

    this.#bar.classList.remove('is-indeterminate');

    if (state.status === 'ready' && state.score) {
      const words = state.score.lines.reduce((sum, line) => sum + line.words.length, 0);
      const guessed = state.score.lines
        .flatMap((line) => line.words)
        .filter((word) => word.source === 'rules').length;
      this.#bar.style.width = '100%';
      this.#message.textContent = `${words} words · ${state.score.lines.length} lines`;
      this.#detail.textContent = guessed
        ? `${guessed} pronunciation${guessed === 1 ? '' : 's'} guessed from spelling`
        : 'Every word found in the dictionary';
      return;
    }

    this.#bar.style.width = '0%';
    this.#message.textContent = 'Ready';
    this.#detail.textContent = '';
  }
}

const STAGE_LABELS: Record<string, string> = {
  decode: 'Decoding',
  analyze: 'Analysing',
  transcribe: 'Transcribing',
  phonemize: 'Phonemizing',
  translate: 'Translating',
};
