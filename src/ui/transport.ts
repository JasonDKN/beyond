import type { Player } from '@/audio/player';
import type { State } from '@/core/store';
import { el, formatClock, ICONS, svgIcon } from './dom';

/** Playback controls. Deliberately few: play, scrub, slow down, zoom in. */
export class TransportView {
  readonly element: HTMLElement;

  #player: Player;
  #playButton: HTMLButtonElement;
  #clock: HTMLElement;
  #rate: HTMLSelectElement;
  #zoom: HTMLInputElement;
  #onZoom: (zoom: number) => void;

  constructor(player: Player, onZoom: (zoom: number) => void) {
    this.#player = player;
    this.#onZoom = onZoom;

    this.#playButton = el('button', {
      class: 'transport__play',
      type: 'button',
      'aria-label': 'Play',
      onclick: () => this.#player.toggle(),
    });
    this.#playButton.appendChild(svgIcon(ICONS.play, 'Play'));

    this.#clock = el('div', { class: 'transport__clock' }, '0:00 / 0:00');

    this.#rate = el(
      'select',
      {
        class: 'transport__rate',
        'aria-label': 'Playback speed',
        onchange: () => {
          this.#player.playbackRate = Number(this.#rate.value);
        },
      },
      ...['0.5', '0.65', '0.8', '1', '1.25', '1.5'].map((value) =>
        el('option', { value, selected: value === '1' }, `${value}×`),
      ),
    ) as HTMLSelectElement;

    this.#zoom = el('input', {
      class: 'transport__zoom',
      type: 'range',
      min: '1',
      max: '16',
      step: '0.5',
      value: '1',
      'aria-label': 'Zoom the staff',
      oninput: () => this.#onZoom(Number(this.#zoom.value)),
    }) as HTMLInputElement;

    this.element = el(
      'div',
      { class: 'transport' },
      el(
        'div',
        { class: 'transport__group' },
        iconButton(ICONS.back, 'Back 5 seconds', () => this.#player.nudge(-5)),
        this.#playButton,
        iconButton(ICONS.forward, 'Forward 5 seconds', () => this.#player.nudge(5)),
      ),
      this.#clock,
      el(
        'div',
        { class: 'transport__group transport__group--right' },
        el('label', { class: 'transport__label' }, 'Speed', this.#rate),
        el('label', { class: 'transport__label' }, 'Zoom', this.#zoom),
      ),
    );
  }

  update(state: State): void {
    const playing = state.playing;
    this.#playButton.replaceChildren(
      svgIcon(playing ? ICONS.pause : ICONS.play, playing ? 'Pause' : 'Play'),
    );
    this.#playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.#clock.textContent = `${formatClock(state.currentTime)} / ${formatClock(
      state.audio?.durationSec ?? 0,
    )}`;
    this.element.classList.toggle('is-disabled', !state.audio);
  }
}

function iconButton(path: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    class: 'transport__button',
    type: 'button',
    'aria-label': label,
    title: label,
    onclick: onClick,
  });
  button.appendChild(svgIcon(path, label));
  return button;
}
