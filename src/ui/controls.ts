import { LANGUAGES } from '@/core/languages';
import type { State, Store } from '@/core/store';
import type { LanguageTag, Notation } from '@/core/types';
import { download, EXPORT_LABELS, exportScore, mimeFor, type ExportFormat } from '@/export';
import { restyleScore } from '@/phonetics/phonemize';
import { hasG2P } from '@/phonetics/registry';
import { listProviders } from '@/transcription';
import { hasTranslation } from '@/translation/provider';
import { el } from './dom';

/**
 * The control bar.
 *
 * Input language and output language are two separate menus on purpose. One
 * decides how the words are pronounced, the other what they are rendered
 * alongside — and keeping them apart is what makes "add a language" a small
 * change rather than a rewrite.
 */
export class ControlsView {
  readonly element: HTMLElement;

  #store: Store;
  #inputLanguage: HTMLSelectElement;
  #outputLanguage: HTMLSelectElement;
  #provider: HTMLSelectElement;
  #notation: HTMLSelectElement;
  #exportSelect: HTMLSelectElement;
  #coverage: HTMLElement;

  constructor(store: Store) {
    this.#store = store;

    this.#inputLanguage = select(
      'Sung in',
      LANGUAGES.map((language) => ({
        value: language.tag,
        label: language.tag === 'auto' ? language.englishName : `${language.englishName} · ${language.nativeName}`,
      })),
      'auto',
      (value) => {
        this.#store.patch({ inputLanguage: value as LanguageTag });
        this.#updateCoverage(this.#store.state);
      },
    );

    this.#outputLanguage = select(
      'Alongside',
      [
        { value: '', label: 'IPA only' },
        ...LANGUAGES.filter((language) => language.tag !== 'auto').map((language) => ({
          value: language.tag,
          label: `IPA + ${language.englishName}`,
        })),
      ],
      '',
      (value) => this.#store.patch({ outputLanguage: value === '' ? null : value }),
    );

    this.#provider = select(
      'Transcribe with',
      listProviders().map((provider) => ({ value: provider.id, label: provider.label })),
      store.state.providerId,
      (value) => this.#store.patch({ providerId: value }),
    );

    this.#notation = select(
      'Notation',
      [
        { value: 'ipa', label: 'IPA (narrow)' },
        { value: 'ipa-broad', label: 'IPA (broad)' },
        { value: 'arpabet', label: 'ARPAbet' },
      ],
      'ipa',
      (value) => this.#restyle({ notation: value as Notation }),
    );

    this.#exportSelect = select(
      'Export',
      [
        { value: '', label: 'Export…' },
        ...(Object.entries(EXPORT_LABELS) as [ExportFormat, string][]).map(([value, label]) => ({
          value,
          label,
        })),
      ],
      '',
      (value) => {
        if (value) this.#export(value as ExportFormat);
        this.#exportSelect.value = '';
      },
    );

    this.#coverage = el('p', { class: 'controls__coverage' });

    this.element = el(
      'div',
      { class: 'controls' },
      field('Sung in', this.#inputLanguage),
      field('Alongside', this.#outputLanguage),
      field('Engine', this.#provider),
      field('Notation', this.#notation),
      toggle('Syllable breaks', false, (checked) => this.#restyle({ syllableBreaks: checked })),
      toggle('Sung vowels', true, (checked) =>
        this.#store.patch({
          singing: { ...this.#store.state.singing, enabled: checked },
        }),
      ),
      field('Export', this.#exportSelect),
      this.#coverage,
    );

    if (!hasTranslation()) {
      this.#outputLanguage.title =
        'No translation engine is registered yet. Register one in src/translation and this menu becomes live.';
    }
  }

  update(state: State): void {
    this.#exportSelect.disabled = !state.score;
    this.#provider.disabled = state.status === 'working';
    this.#inputLanguage.disabled = state.status === 'working';
    this.#updateCoverage(state);
  }

  #updateCoverage(state: State): void {
    const language = state.score?.inputLanguage ?? state.inputLanguage;
    if (language === 'auto') {
      this.#coverage.textContent = 'Language will be detected from the audio.';
      this.#coverage.className = 'controls__coverage';
      return;
    }
    if (hasG2P(language)) {
      this.#coverage.textContent = `Phonetic engine available for ${language}.`;
      this.#coverage.className = 'controls__coverage is-ok';
    } else {
      this.#coverage.textContent = `Beyond can transcribe ${language} but has no phonetic engine for it yet — words will pass through unconverted.`;
      this.#coverage.className = 'controls__coverage is-warn';
    }
  }

  #restyle(options: { notation?: Notation; syllableBreaks?: boolean }): void {
    const state = this.#store.state;
    const next = {
      notation: options.notation ?? state.notation,
      syllableBreaks: options.syllableBreaks ?? state.syllableBreaks,
      stressMarks: state.stressMarks,
    };
    this.#store.patch({
      ...next,
      ...(state.score ? { score: restyleScore(state.score, next) } : {}),
    });
  }

  #export(format: ExportFormat): void {
    const score = this.#store.state.score;
    if (!score) return;
    const safeTitle = score.title.replace(/[^\w\- ]+/g, '').trim() || 'beyond';
    download(`${safeTitle}.${format}`, exportScore(score, format), mimeFor(format));
  }
}

function select(
  label: string,
  options: readonly { value: string; label: string }[],
  initial: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = el(
    'select',
    {
      class: 'control__select',
      'aria-label': label,
      onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
    },
    ...options.map((option) =>
      el('option', { value: option.value, selected: option.value === initial }, option.label),
    ),
  ) as HTMLSelectElement;
  node.value = initial;
  return node;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el(
    'label',
    { class: 'control' },
    el('span', { class: 'control__label' }, label),
    control,
  );
}

function toggle(label: string, initial: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    class: 'control__checkbox',
    checked: initial,
    onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
  });
  return el('label', { class: 'control control--toggle' }, input, el('span', {}, label));
}
