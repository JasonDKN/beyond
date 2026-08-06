import type { State } from '@/core/store';
import {
  deleteTrack,
  deleteTrackAudio,
  formatBytes,
  formatWhen,
  listTracks,
  type TrackSummary,
} from '@/storage/library';
import { clear, el, formatClock } from './dom';

/**
 * Your saved tracks.
 *
 * The work was always kept separately per song; what was missing was any way
 * to see it. A song you tapped out last week should be one click from where
 * you left it, not a hunt through a file picker for the right MP3.
 */

export interface LibraryCallbacks {
  onOpen(track: TrackSummary): void;
}

export class LibraryView {
  readonly element: HTMLElement;

  #callbacks: LibraryCallbacks;
  #list: HTMLElement;
  #summary: HTMLElement;
  #tracks: TrackSummary[] = [];

  constructor(callbacks: LibraryCallbacks) {
    this.#callbacks = callbacks;
    this.#list = el('div', { class: 'library__list' });
    this.#summary = el('p', { class: 'library__summary' });

    this.element = el(
      'section',
      { class: 'library' },
      el(
        'header',
        { class: 'library__head' },
        el('h2', { class: 'library__title' }, 'Your tracks'),
        this.#summary,
      ),
      this.#list,
    );
  }

  /** Re-read from storage. Cheap — the audio blobs live in a separate store. */
  async refresh(): Promise<void> {
    this.#tracks = await listTracks();
    this.#render();
  }

  update(state: State): void {
    // The library belongs to the opening screen; once a song is loaded the
    // stage takes over.
    this.element.classList.toggle('is-hidden', state.audio !== null || this.#tracks.length === 0);
  }

  #render(): void {
    clear(this.#list);

    if (this.#tracks.length === 0) {
      this.element.classList.add('is-hidden');
      return;
    }
    this.element.classList.remove('is-hidden');

    const stored = this.#tracks.reduce((sum, track) => sum + (track.bytes || 0), 0);
    this.#summary.textContent = `${this.#tracks.length} saved · ${formatBytes(stored)} on this device`;

    for (const track of this.#tracks) {
      this.#list.appendChild(this.#row(track));
    }
  }

  #row(track: TrackSummary): HTMLElement {
    const done = track.totalLines > 0 && track.timedLines === track.totalLines;
    const progress =
      track.totalLines === 0
        ? 'no lyrics yet'
        : `${track.timedLines} of ${track.totalLines} lines timed`;

    const open = el(
      'button',
      {
        class: 'library__open',
        type: 'button',
        // Without the audio we cannot reopen it unaided; say so up front
        // rather than failing after the click.
        title: track.hasAudio
          ? `Open ${track.title}`
          : `${track.title} — the audio is not stored, so you'll be asked for the file`,
        onclick: () => this.#callbacks.onOpen(track),
      },
      el('span', { class: 'library__name' }, track.title),
      el(
        'span',
        { class: 'library__meta' },
        `${formatClock(track.durationSec)} · ${progress} · ${formatWhen(track.updatedAt)}`,
      ),
      el('span', {
        class: `library__bar${done ? ' is-complete' : ''}`,
        style: `--progress:${track.totalLines ? track.timedLines / track.totalLines : 0}`,
      }),
    );

    const actions = el(
      'div',
      { class: 'library__actions' },
      track.hasAudio
        ? el(
            'button',
            {
              class: 'library__action',
              type: 'button',
              title: `Free ${formatBytes(track.bytes)} by removing the stored audio. Your timings are kept.`,
              onclick: () => void this.#dropAudio(track),
            },
            formatBytes(track.bytes),
          )
        : el('span', { class: 'library__noaudio', title: 'Audio not stored' }, 'no audio'),
      el(
        'button',
        {
          class: 'library__action library__action--delete',
          type: 'button',
          title: `Delete ${track.title} and all its timings`,
          onclick: () => void this.#confirmDelete(track),
        },
        '✕',
      ),
    );

    return el('div', { class: 'library__row' }, open, actions);
  }

  async #dropAudio(track: TrackSummary): Promise<void> {
    await deleteTrackAudio(track.id);
    await this.refresh();
  }

  /**
   * Two-step delete. Losing an evening of tapping to a stray click would be
   * miserable, and this is the one irreversible action in the app.
   */
  async #confirmDelete(track: TrackSummary): Promise<void> {
    const row = [...this.#list.querySelectorAll('.library__row')].find((node) =>
      node.querySelector('.library__name')?.textContent === track.title,
    );
    const button = row?.querySelector('.library__action--delete');
    if (!button) return;

    if (button.classList.contains('is-confirming')) {
      await deleteTrack(track.id);
      await this.refresh();
      return;
    }

    button.classList.add('is-confirming');
    button.textContent = 'Delete?';
    setTimeout(() => {
      button.classList.remove('is-confirming');
      button.textContent = '✕';
    }, 4000);
  }
}
