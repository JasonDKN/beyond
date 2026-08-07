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
  /** Only used by the drawer, to dismiss it. */
  onClose?: () => void;
  /** Only used by the drawer, to pick a file not yet in the library. */
  onOpenFile?: () => void;
}

/**
 * Where this list is being shown.
 *
 * `opening` is the landing screen. `drawer` slides over the workspace so you
 * can change songs without reloading — the same data, different framing, and
 * cheap enough to simply render twice rather than share one instance between
 * two very different layouts.
 */
export type LibraryVariant = 'opening' | 'drawer';

export class LibraryView {
  readonly element: HTMLElement;

  #callbacks: LibraryCallbacks;
  #list: HTMLElement;
  #summary: HTMLElement;
  #tracks: TrackSummary[] = [];

  #variant: LibraryVariant;
  /** Last state seen, so a refresh can re-apply visibility without one. */
  #lastState: State | null = null;

  constructor(callbacks: LibraryCallbacks, variant: LibraryVariant = 'opening') {
    this.#callbacks = callbacks;
    this.#variant = variant;
    this.#list = el('div', { class: 'library__list' });
    this.#summary = el('p', { class: 'library__summary' });

    this.element = el(
      'section',
      // Starts hidden. The drawer covers the whole workspace, so it must never
      // be on screen for even one frame before it has been asked for.
      { class: `library library--${variant} is-hidden` },
      el(
        'header',
        { class: 'library__head' },
        el('h2', { class: 'library__title' }, 'Your tracks'),
        this.#summary,
        variant === 'drawer'
          ? el(
              'button',
              {
                class: 'library__close',
                type: 'button',
                'aria-label': 'Close',
                onclick: () => this.#callbacks.onClose?.(),
              },
              '✕',
            )
          : null,
      ),
      this.#list,
      variant === 'drawer'
        ? el(
            'footer',
            { class: 'library__foot', 'data-variant': variant },
            el(
              'button',
              {
                class: 'library__newfile',
                type: 'button',
                onclick: () => this.#callbacks.onOpenFile?.(),
              },
              'Open a new song…',
            ),
          )
        : null,
    );
  }

  /** Re-read from storage. Cheap — the audio blobs live in a separate store. */
  async refresh(): Promise<void> {
    this.#tracks = await listTracks();
    this.#render();
  }

  update(state: State): void {
    this.#lastState = state;
    this.#applyVisibility();
    if (this.#variant === 'drawer') this.#markCurrent(state.trackId);
  }

  /** Mark the song you are already in, so you do not reopen it by accident. */
  #markCurrent(trackId: string | null): void {
    this.#list.querySelectorAll('.library__row').forEach((row) => {
      const id = (row as HTMLElement).dataset['trackId'];
      row.classList.toggle('is-current', Boolean(trackId) && id === trackId);
    });
  }

  #render(): void {
    clear(this.#list);

    // Visibility is decided in one place only — see #applyVisibility. Deciding
    // it here too meant a refresh could pop the drawer open over the workspace
    // and swallow every click behind it.
    if (this.#tracks.length === 0) {
      this.#applyVisibility();
      return;
    }

    const stored = this.#tracks.reduce((sum, track) => sum + (track.bytes || 0), 0);
    this.#summary.textContent = `${this.#tracks.length} saved · ${formatBytes(stored)} on this device`;

    for (const track of this.#tracks) {
      this.#list.appendChild(this.#row(track));
    }

    // Rows are rebuilt here, after the last update() ran, so the "open now"
    // marker has to be re-applied or it is lost on every refresh.
    if (this.#variant === 'drawer') this.#markCurrent(this.#lastState?.trackId ?? null);
    this.#applyVisibility();
  }

  /** The single source of truth for whether this list is on screen. */
  #applyVisibility(): void {
    const state = this.#lastState;
    if (this.#variant === 'drawer') {
      // Hidden until asked for, and only ever over a loaded song.
      const show = Boolean(state?.libraryOpen) && Boolean(state?.audio);
      this.element.classList.toggle('is-hidden', !show);
      return;
    }
    const show = !state?.audio && this.#tracks.length > 0;
    this.element.classList.toggle('is-hidden', !show);
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

    return el('div', { class: 'library__row', 'data-track-id': track.id }, open, actions);
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
