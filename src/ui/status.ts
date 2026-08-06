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

    this.element.classList.toggle('has-notice', state.notice !== null && state.status !== 'error');

    if (state.status === 'error') {
      this.#bar.style.width = '100%';
      this.#message.textContent = state.error ?? 'Something went wrong.';
      this.#detail.textContent = '';
      return;
    }

    // A next step, not a failure.
    if (state.notice && !state.progress) {
      this.#bar.style.width = '0%';
      this.#message.textContent = state.notice;
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
      const allWords = state.score.lines.flatMap((line) => line.words);
      const words = allWords.length;
      // Only a genuine guess counts as one. A Korean reading derived by the
      // standard rules is not a guess, and reporting it as one would teach the
      // user to distrust the most reliable thing on the screen.
      const guessed = allWords.filter((word) => word.source === 'rules').length;
      const changed = allWords.filter((word) => word.changed).length;

      this.#bar.style.width = '100%';
      this.#message.textContent = `${words} words · ${state.score.lines.length} lines`;

      if (guessed > 0) {
        this.#detail.textContent = `${guessed} pronunciation${guessed === 1 ? '' : 's'} guessed from spelling`;
      } else if (changed > 0) {
        // The most useful number on screen for a learner: how many words are
        // not said the way they are written.
        this.#detail.textContent = `${changed} word${changed === 1 ? '' : 's'} pronounced differently from the spelling`;
      } else {
        this.#detail.textContent = 'Every pronunciation resolved';
      }
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
