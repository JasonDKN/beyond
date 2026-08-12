import type { State } from '@/core/store';
import {
  deleteTrack,
  deleteTrackAudio,
  exportLibrary,
  formatBytes,
  formatWhen,
  getTrack,
  getTrackAudio,
  importLibrary,
  listTracks,
  type TrackSummary,
} from '@/storage/library';
import { commitFileName, embedAudio, serializeProject } from '@/storage/project';
import { download } from '@/export';
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
  /** Only used by the drawer, to open a saved project file from disk. */
  onOpenProject?: () => void;
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
  /** Set when storage could not be read — distinct from having no tracks. */
  #error: string | null = null;
  #restoreInput: HTMLInputElement;

  constructor(callbacks: LibraryCallbacks, variant: LibraryVariant = 'opening') {
    this.#callbacks = callbacks;
    this.#variant = variant;
    this.#list = el('div', { class: 'library__list' });
    this.#summary = el('p', { class: 'library__summary' });

    this.#restoreInput = el('input', {
      type: 'file',
      class: 'visually-hidden',
      accept: '.json,application/json',
      onchange: (event: Event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (file) void this.#restore(file);
      },
    }) as HTMLInputElement;

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
        // Backup lives next to the list, not in a settings menu. It is only
        // worth having if it is in front of you at the moment you think
        // "I should not lose this".
        el(
          'button',
          {
            class: 'library__backup',
            type: 'button',
            'data-tip': 'Download your lyrics, timings and translations as a file',
            onclick: () => void this.#backup(),
          },
          'Back up',
        ),
        el(
          'button',
          {
            class: 'library__backup',
            type: 'button',
            'data-tip': 'Restore tracks from a backup file',
            onclick: () => this.#restoreInput.click(),
          },
          'Restore',
        ),
        this.#restoreInput,
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
                'data-tip': 'Open a commit, or a project file you saved to a folder',
                onclick: () => this.#callbacks.onOpenProject?.(),
              },
              'Open a commit…',
            ),
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
    try {
      this.#tracks = await listTracks();
      this.#error = null;
    } catch (error) {
      // Crucially, do *not* fall back to an empty list. Showing "no saved
      // tracks" when storage merely failed to open reads as "your work is
      // gone" and invites starting over — which is how work actually gets
      // lost. Say what happened instead.
      this.#tracks = [];
      this.#error =
        error instanceof Error ? error.message : 'The library could not be read.';
    }
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

    // A read failure is not an empty library, and must never be shown as one.
    if (this.#error) {
      this.#summary.textContent = '';
      this.#list.appendChild(
        el(
          'div',
          { class: 'library__problem' },
          el('p', {}, `Your saved tracks could not be loaded. ${this.#error}`),
          el(
            'p',
            { class: 'library__problem-hint' },
            'Your work has not been deleted — this is a problem reading storage. Private browsing and full disks are the usual causes.',
          ),
        ),
      );
      this.#applyVisibility();
      return;
    }

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
    // Shown when there is something to say — tracks, or a storage problem
    // worth reporting rather than hiding.
    const show = !state?.audio && (this.#tracks.length > 0 || this.#error !== null);
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
        'data-tip': track.hasAudio
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
      // A commit is only worth offering when there is a song to put in it.
      track.hasAudio
        ? el(
            'button',
            {
              class: 'library__action library__action--commit',
              type: 'button',
              'data-tip':
                `Commit ${track.title} and take it with you\n` +
                'One file holding the words, timings and the song itself — ' +
                'open it on your phone and everything is there',
              onclick: () => void this.#commit(track),
            },
            'Commit',
          )
        : null,
      track.hasAudio
        ? el(
            'button',
            {
              class: 'library__action',
              type: 'button',
              'data-tip': `Free ${formatBytes(track.bytes)} by removing the stored audio. Your timings are kept.`,
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
          'data-tip': `Delete ${track.title} and all its timings`,
          onclick: () => void this.#confirmDelete(track),
        },
        '✕',
      ),
    );

    return el('div', { class: 'library__row', 'data-track-id': track.id }, open, actions);
  }

  /**
   * Write one song out complete: the work and the music in a single file.
   *
   * The normal project file leaves the audio out, because the fingerprint
   * finds it again on a machine that already has it. A device you have never
   * opened this song on cannot do that, so a commit carries the song along —
   * which is the whole difference between arriving with your work and
   * arriving with a file that asks you for an MP3 you left at home.
   */
  async #commit(track: TrackSummary): Promise<void> {
    this.#summary.textContent = `Committing ${track.title}…`;
    try {
      const [record, blob] = await Promise.all([getTrack(track.id), getTrackAudio(track.id)]);
      if (!record || !blob) {
        this.#summary.textContent = 'That track has no stored audio to commit.';
        return;
      }
      const audio = await embedAudio(blob, record.fileName);
      download(commitFileName(record.title), serializeProject(record, audio), 'application/json');
      this.#summary.textContent =
        `${track.title} committed — ${formatBytes(blob.size)} of song included. ` +
        'Open it on your other device.';
    } catch {
      this.#summary.textContent = 'That track could not be committed.';
    }
  }

  async #backup(): Promise<void> {
    try {
      const json = await exportLibrary();
      const stamp = new Date().toISOString().slice(0, 10);
      download(`beyond-library-${stamp}.json`, json, 'application/json');
      this.#summary.textContent = 'Backup downloaded.';
    } catch {
      this.#summary.textContent = 'Could not read the library to back it up.';
    }
  }

  async #restore(file: File): Promise<void> {
    try {
      const result = await importLibrary(await file.text());
      await this.refresh();
      this.#summary.textContent =
        result.restored === 0
          ? `Nothing restored — your saved copies are already newer (${result.skipped} skipped).`
          : `Restored ${result.restored} track${result.restored === 1 ? '' : 's'}.`;
    } catch (error) {
      this.#summary.textContent =
        error instanceof Error ? error.message : 'That backup could not be read.';
    }
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
