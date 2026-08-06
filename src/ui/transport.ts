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
  #loopA: HTMLButtonElement;
  #loopB: HTMLButtonElement;
  #loopClear: HTMLButtonElement;
  #pendingA: number | null = null;

  constructor(player: Player, onZoom: (zoom: number) => void) {
    this.#player = player;
    this.#onZoom = onZoom;

    this.#loopA = el(
      'button',
      {
        class: 'transport__loop-button',
        type: 'button',
        title: 'Set the loop start here  [',
        onclick: () => {
          this.#pendingA = this.#player.currentTime;
          this.#loopA.classList.add('is-set');
        },
      },
      'A',
    ) as HTMLButtonElement;

    this.#loopB = el(
      'button',
      {
        class: 'transport__loop-button',
        type: 'button',
        title: 'Set the loop end here and start looping  ]',
        onclick: () => this.#player.setLoop(this.#pendingA ?? 0, this.#player.currentTime),
      },
      'B',
    ) as HTMLButtonElement;

    this.#loopClear = el(
      'button',
      {
        class: 'transport__loop-button transport__loop-button--clear',
        type: 'button',
        title: 'Clear the loop  \\',
        onclick: () => {
          this.#player.clearLoop();
          this.#pendingA = null;
          this.#loopA.classList.remove('is-set');
        },
      },
      '✕',
    ) as HTMLButtonElement;

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
        { class: 'transport__group transport__loop' },
        this.#loopA,
        this.#loopB,
        this.#loopClear,
      ),
      el(
        'div',
        { class: 'transport__group transport__group--right' },
        el('label', { class: 'transport__label' }, 'Speed', this.#rate),
        el('label', { class: 'transport__label' }, 'Zoom', this.#zoom),
      ),
    );

    this.#bindLoopKeys();
  }

  /**
   * A–B loop.
   *
   * Set A at the start of a phrase, B at the end, and it repeats until you can
   * do it. This and the speed control are the two things that actually get a
   * hard passage into your mouth; everything else on this bar is convenience.
   */
  #bindLoopKeys(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === '[') {
        this.#pendingA = this.#player.currentTime;
        this.#loopA.classList.add('is-set');
      } else if (event.key === ']') {
        this.#player.setLoop(this.#pendingA ?? 0, this.#player.currentTime);
      } else if (event.key === '\\') {
        this.#player.clearLoop();
        this.#pendingA = null;
        this.#loopA.classList.remove('is-set');
      } else {
        return;
      }
      event.preventDefault();
    });
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

    const looping = state.loop !== null;
    this.#loopB.classList.toggle('is-set', looping);
    this.#loopClear.disabled = !looping && this.#pendingA === null;
    this.element.classList.toggle('is-looping', looping);
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
