import type { Player } from '@/audio/player';
import type { State, Store } from '@/core/store';
import {
  freshId,
  getSheet,
  occurrenceOffsets,
  sectionKindFor,
  sectionLineTimes,
  sectionWarnings,
  type Artist,
  type LyricLine,
  type LyricSection,
  type SectionKind,
  type SectionOccurrence,
} from '@/transcription/providers/lyrics';
import { clear, el, formatClock } from './dom';

/**
 * Compartmentalize: the shape of the song, said out loud.
 *
 * Nothing here is detected. Earlier versions tried to find the chorus by
 * looking for the block of lines that repeats, and that works often enough to
 * be worse than useless — you stop reading what it produced, and the one time
 * it is wrong you have built a score on it. A song's structure is something
 * you know and the app does not.
 *
 * So: the lines on the left, exactly as pasted. The parts you say the song has
 * on the right. You group lines and drop them into a part; you say where that
 * part happens, and where it happens again. A hook that returns four times is
 * typed once, tapped once, and marked four times.
 *
 * The artist roster is the other half. A BTS verse trades lines between
 * members every couple of bars, so assigning by section alone cannot describe
 * it — a section carries a default and any line can override it.
 */

export interface CompartmentalizeCallbacks {
  /** Persist the sheet's structure. */
  onCommit(change: {
    lines?: readonly LyricLine[];
    sections?: readonly LyricSection[];
    artists?: readonly Artist[];
  }): void;
  onSeek(seconds: number): void;
  onPlay(): void;
  onLoop(startSec: number, endSec: number): void;
}

const KINDS: readonly { value: SectionKind; label: string }[] = [
  { value: 'intro', label: 'Intro' },
  { value: 'verse', label: 'Verse' },
  { value: 'pre-chorus', label: 'Pre-chorus' },
  { value: 'chorus', label: 'Chorus / Hook' },
  { value: 'post-chorus', label: 'Post-chorus' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'refrain', label: 'Refrain' },
  { value: 'outro', label: 'Outro' },
  { value: 'other', label: 'Other' },
];

/** How long a brand-new occurrence runs, before you set its end. */
const DEFAULT_OCCURRENCE_SEC = 15;

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 5;

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly index: number;
  active: boolean;
  ghost: HTMLElement | null;
  target: HTMLElement | null;
}

export class CompartmentalizeView {
  readonly element: HTMLElement;

  #store: Store;
  #callbacks: CompartmentalizeCallbacks;

  #lineList: HTMLElement;
  #sectionList: HTMLElement;
  #artistList: HTMLElement;
  #summary: HTMLElement;
  #unassignedDrop: HTMLElement;

  /** Which lines are picked up, by index into the sheet. */
  #selected = new Set<number>();
  /** Where a shift-click measures its range from. */
  #anchor: number | null = null;
  #lineRows: HTMLElement[] = [];
  #drag: DragState | null = null;
  /** Set after a drag, so the click it ends with does not also re-select. */
  #swallowClick = false;
  /** Set while an input inside the panel has focus, so redraws do not fight typing. */
  #editing = false;
  #signature = '';

  constructor(store: Store, _player: Player, callbacks: CompartmentalizeCallbacks) {
    this.#store = store;
    this.#callbacks = callbacks;

    this.#lineList = el('ol', { class: 'compart__lines' });
    this.#sectionList = el('div', { class: 'compart__sections' });
    this.#artistList = el('div', { class: 'compart__artists' });
    this.#summary = el('p', { class: 'compart__summary' });

    // Somewhere to put a line back when it does not belong to any part.
    this.#unassignedDrop = el(
      'div',
      {
        class: 'compart__unassign',
        title: 'Drop lines here to take them out of every section',
        ...this.#dropHandlers(null),
      },
      'Not in any section',
    );

    this.element = el(
      'section',
      { class: 'compart' },
      el(
        'div',
        { class: 'compart__col compart__col--lines' },
        el(
          'header',
          { class: 'compart__head' },
          el('h2', { class: 'compart__title' }, 'Lines'),
          this.#summary,
        ),
        el(
          'p',
          { class: 'compart__hint' },
          'Click to select · Shift-click for a run · ',
          el('kbd', {}, 'Ctrl'),
          '-click to add · then drag into a section',
        ),
        this.#lineList,
        this.#unassignedDrop,
      ),
      el(
        'div',
        { class: 'compart__col compart__col--panel' },
        el(
          'header',
          { class: 'compart__head' },
          el('h2', { class: 'compart__title' }, 'Artists'),
          el(
            'button',
            {
              class: 'compart__add',
              type: 'button',
              title: 'Add someone who sings on this track',
              onclick: () => this.#addArtist(),
            },
            '+ Add artist',
          ),
        ),
        this.#artistList,
        el(
          'header',
          { class: 'compart__head compart__head--sections' },
          el('h2', { class: 'compart__title' }, 'Sections'),
          el(
            'button',
            {
              class: 'compart__add',
              type: 'button',
              title: 'Add a part of the song',
              onclick: () => this.#addSection(),
            },
            '+ Add section',
          ),
        ),
        this.#sectionList,
      ),
    );
  }

  update(state: State): void {
    if (state.mode !== 'compartmentalize') return;
    // Redrawing while someone is typing in a label or a timestamp would move
    // the caret out from under them; the playhead ticks sixty times a second.
    if (this.#editing) return;

    const signature = this.#signatureOf();
    if (signature === this.#signature) return;
    this.#signature = signature;
    this.#render();
  }

  /** Everything this view draws, flattened — so it redraws only when it must. */
  #signatureOf(): string {
    const sheet = getSheet();
    return JSON.stringify([
      sheet.lines.map((line) => [line.text, line.startSec, line.sectionId, line.artistId]),
      sheet.sections,
      sheet.artists,
      [...this.#selected].sort((a, b) => a - b),
    ]);
  }

  /** Force the next update to redraw, after this view changed something. */
  #invalidate(): void {
    this.#signature = '';
  }

  // --- artists -------------------------------------------------------------

  #artists(): readonly Artist[] {
    return getSheet().artists ?? [];
  }

  #addArtist(): void {
    const artists = [...this.#artists(), { id: freshId('art'), name: '' }];
    this.#callbacks.onCommit({ artists });
    this.#invalidate();
  }

  #renderArtists(): void {
    clear(this.#artistList);
    const artists = this.#artists();

    if (artists.length === 0) {
      this.#artistList.appendChild(
        el(
          'p',
          { class: 'compart__empty' },
          'No one added yet. Add each singer, then tag sections and lines with who takes them.',
        ),
      );
      return;
    }

    artists.forEach((artist, index) => {
      const name = el('input', {
        class: 'compart__artist-name',
        type: 'text',
        value: artist.name,
        placeholder: `Artist ${index + 1}`,
        'aria-label': 'Artist name',
        onfocus: () => (this.#editing = true),
        onblur: (event: Event) => {
          this.#editing = false;
          const value = (event.target as HTMLInputElement).value.trim();
          if (value === artist.name) return;
          this.#callbacks.onCommit({
            artists: this.#artists().map((entry) =>
              entry.id === artist.id ? { ...entry, name: value } : entry,
            ),
          });
          this.#invalidate();
        },
      });

      this.#artistList.appendChild(
        el(
          'div',
          { class: `compart__artist is-artist-${index % 6}` },
          el('span', { class: 'compart__swatch' }),
          name,
          el(
            'button',
            {
              class: 'compart__remove',
              type: 'button',
              title: 'Remove this artist and clear them off every line',
              onclick: () => this.#removeArtist(artist.id),
            },
            '✕',
          ),
        ),
      );
    });
  }

  #removeArtist(artistId: string): void {
    const sheet = getSheet();
    this.#callbacks.onCommit({
      artists: this.#artists().filter((artist) => artist.id !== artistId),
      // Leaving the id behind on lines would show a blank tag that nothing
      // could clear.
      lines: sheet.lines.map((line) => {
        if (line.artistId !== artistId) return line;
        const { artistId: _dropped, ...rest } = line;
        return rest;
      }),
      sections: (sheet.sections ?? []).map((section) => {
        if (section.artistId !== artistId) return section;
        const { artistId: _dropped, ...rest } = section;
        return rest;
      }),
    });
    this.#invalidate();
  }

  #artistIndex(artistId: string | undefined): number {
    if (artistId === undefined) return -1;
    return this.#artists().findIndex((artist) => artist.id === artistId);
  }

  #artistName(artistId: string | undefined): string {
    const artist = this.#artists().find((entry) => entry.id === artistId);
    if (!artist) return '';
    return artist.name || 'Unnamed';
  }

  /** A dropdown of the roster, plus "nobody". */
  #artistSelect(
    current: string | undefined,
    onChange: (artistId: string | undefined) => void,
    blankLabel: string,
  ): HTMLElement {
    const select = el('select', {
      class: `compart__artist-pick is-artist-${this.#artistIndex(current) % 6}`,
      'aria-label': 'Artist',
      onfocus: () => (this.#editing = true),
      onblur: () => (this.#editing = false),
      onchange: (event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.#editing = false;
        onChange(value === '' ? undefined : value);
      },
    }) as HTMLSelectElement;

    select.appendChild(el('option', { value: '' }, blankLabel));
    for (const artist of this.#artists()) {
      select.appendChild(
        el('option', { value: artist.id }, artist.name || 'Unnamed'),
      );
    }
    select.value = current ?? '';
    return select;
  }

  // --- sections ------------------------------------------------------------

  #sections(): readonly LyricSection[] {
    return getSheet().sections ?? [];
  }

  #addSection(): void {
    const label = `Section ${this.#sections().length + 1}`;
    const section: LyricSection = {
      id: freshId('sec'),
      label,
      kind: 'other',
      occurrences: [],
    };
    this.#callbacks.onCommit({ sections: [...this.#sections(), section] });
    this.#invalidate();

    // If lines are already picked up, adding a section is almost always the
    // act of making a home for them.
    if (this.#selected.size > 0) this.#assign(section.id);
  }

  #patchSection(sectionId: string, change: Partial<LyricSection>): void {
    this.#callbacks.onCommit({
      sections: this.#sections().map((section) =>
        section.id === sectionId ? { ...section, ...change } : section,
      ),
    });
    this.#invalidate();
  }

  /**
   * Give a whole section to somebody.
   *
   * Also clears the per-line overrides inside it, because the alternative is a
   * control that visibly does nothing: you set the section to Jimin, and the
   * lines you had individually tagged as RM stay RM with no hint why.
   */
  #setSectionArtist(sectionId: string, artistId: string | undefined): void {
    const sheet = getSheet();
    this.#callbacks.onCommit({
      sections: this.#sections().map((section) => {
        if (section.id !== sectionId) return section;
        if (artistId === undefined) {
          const { artistId: _dropped, ...rest } = section;
          return rest;
        }
        return { ...section, artistId };
      }),
      lines: sheet.lines.map((line) => {
        if (line.sectionId !== sectionId || line.artistId === undefined) return line;
        const { artistId: _dropped, ...rest } = line;
        return rest;
      }),
    });
    this.#invalidate();
  }

  #removeSection(sectionId: string): void {
    const sheet = getSheet();
    this.#callbacks.onCommit({
      sections: this.#sections().filter((section) => section.id !== sectionId),
      // The lines survive; they just stop belonging anywhere.
      lines: sheet.lines.map((line) => {
        if (line.sectionId !== sectionId) return line;
        const { sectionId: _dropped, ...rest } = line;
        return rest;
      }),
    });
    this.#invalidate();
  }

  /** Put every selected line into a section — or into none, for `null`. */
  #assign(sectionId: string | null): void {
    if (this.#selected.size === 0) return;
    const lines = getSheet().lines.map((line, index) => {
      if (!this.#selected.has(index)) return line;
      if (sectionId === null) {
        const { sectionId: _dropped, ...rest } = line;
        return rest;
      }
      return { ...line, sectionId };
    });
    this.#callbacks.onCommit({ lines });
    this.#selected.clear();
    this.#anchor = null;
    this.#invalidate();
  }

  /** Where the section's own lines sit, for suggesting a first occurrence. */
  #timedWindow(sectionId: string): { startSec: number; endSec: number } | null {
    const times = getSheet()
      .lines.filter((line) => line.sectionId === sectionId)
      .map((line) => line.startSec)
      .filter((at): at is number => at !== null);
    if (times.length === 0) return null;
    return { startSec: Math.min(...times), endSec: Math.max(...times) + 4 };
  }

  #addOccurrence(section: LyricSection): void {
    const playhead = this.#store.state.currentTime;
    const duration = this.#store.state.audio?.durationSec ?? 0;

    // The first occurrence is the performance you tapped, so offer that window
    // rather than wherever the playhead happens to be sitting.
    const first = section.occurrences.length === 0 ? this.#timedWindow(section.id) : null;
    const length =
      section.occurrences[0] === undefined
        ? DEFAULT_OCCURRENCE_SEC
        : section.occurrences[0].endSec - section.occurrences[0].startSec;

    const startSec = first?.startSec ?? playhead;
    let endSec = Math.min(first?.endSec ?? startSec + length, duration || startSec + length);

    // Stop the guessed end from running into whatever comes next. Overlaps are
    // allowed — a hook's tail under a verse is a real thing — but one you did
    // not ask for is just a mess to clean up.
    const nextStart = this.#nextStartAfter(startSec, section.id);
    if (nextStart !== null && nextStart > startSec) endSec = Math.min(endSec, nextStart);

    this.#patchSection(section.id, {
      occurrences: [...section.occurrences, { id: freshId('occ'), startSec, endSec }].sort(
        (a, b) => a.startSec - b.startSec,
      ),
    });
  }

  /** The earliest occurrence start after `from`, across every other section. */
  #nextStartAfter(from: number, exceptSectionId: string): number | null {
    let best: number | null = null;
    for (const section of this.#sections()) {
      if (section.id === exceptSectionId) continue;
      for (const occurrence of section.occurrences) {
        if (occurrence.startSec <= from + 0.01) continue;
        if (best === null || occurrence.startSec < best) best = occurrence.startSec;
      }
    }
    return best;
  }

  #patchOccurrence(
    section: LyricSection,
    occurrenceId: string,
    change: Partial<SectionOccurrence>,
  ): void {
    const occurrences = section.occurrences
      .map((occurrence) =>
        occurrence.id === occurrenceId ? { ...occurrence, ...change } : occurrence,
      )
      // Keeping them in time order means "the first" always means the earliest,
      // which is what every offset in the score is measured from.
      .sort((a, b) => a.startSec - b.startSec);
    this.#patchSection(section.id, { occurrences });
  }

  #renderSections(): void {
    clear(this.#sectionList);
    const sections = this.#sections();

    if (sections.length === 0) {
      this.#sectionList.appendChild(
        el(
          'p',
          { class: 'compart__empty' },
          'No sections yet. Add one for each part of the song — verse, hook, bridge — then drag its lines in.',
        ),
      );
      return;
    }

    for (const section of sections) {
      this.#sectionList.appendChild(this.#sectionCard(section));
    }
  }

  #sectionCard(section: LyricSection): HTMLElement {
    const lineCount = getSheet().lines.filter((line) => line.sectionId === section.id).length;
    const timedCount = getSheet().lines.filter(
      (line) => line.sectionId === section.id && line.startSec !== null,
    ).length;

    const label = el('input', {
      class: 'compart__label',
      type: 'text',
      value: section.label,
      placeholder: 'Name this part',
      'aria-label': 'Section name',
      onfocus: () => (this.#editing = true),
      onblur: (event: Event) => {
        this.#editing = false;
        const value = (event.target as HTMLInputElement).value.trim();
        if (value === section.label) return;
        // Naming it "후렴" or "サビ" sets the kind too, unless you already
        // chose one. That is reading your own words back, not guessing at the
        // song — and it means the colour matches without a second step.
        const kind = section.kind === 'other' ? sectionKindFor(value) : section.kind;
        this.#patchSection(section.id, { label: value, kind });
      },
    }) as HTMLInputElement;

    const kind = el('select', {
      class: 'compart__kind',
      'aria-label': 'What kind of part this is',
      onfocus: () => (this.#editing = true),
      onblur: () => (this.#editing = false),
      onchange: (event: Event) => {
        this.#editing = false;
        this.#patchSection(section.id, {
          kind: (event.target as HTMLSelectElement).value as SectionKind,
        });
      },
    }) as HTMLSelectElement;
    for (const option of KINDS) {
      kind.appendChild(el('option', { value: option.value }, option.label));
    }
    kind.value = section.kind;

    const occurrences = el('div', { class: 'compart__occurrences' });
    if (section.occurrences.length === 0) {
      occurrences.appendChild(
        el(
          'p',
          { class: 'compart__empty compart__empty--tight' },
          lineCount > 0 && timedCount > 0
            ? 'Not placed yet — "Add where it happens" will offer the moment you tapped.'
            : 'Not placed yet.',
        ),
      );
    }
    section.occurrences.forEach((occurrence, index) => {
      occurrences.appendChild(this.#occurrenceRow(section, occurrence, index));
    });

    // A repeat marked where the part does not actually return will replay its
    // words into whatever else is there. That is one careless click away, and
    // invisible afterwards unless something says so.
    for (const warning of sectionWarnings(getSheet(), section)) {
      occurrences.appendChild(
        el(
          'p',
          { class: 'compart__warn' },
          warning.kind === 'lands-in'
            ? `Repeat ${warning.occurrenceIndex + 1} sits inside “${warning.otherLabel}” — its ${warning.count} line${warning.count === 1 ? '' : 's'} will play there too.`
            : `Repeat ${warning.occurrenceIndex + 1} is too short: ${warning.count} line${warning.count === 1 ? '' : 's'} fall past its end and are left out. Move its end later.`,
        ),
      );
    }

    return el(
      'article',
      {
        class: `compart__section is-${section.kind}`,
        ...this.#dropHandlers(section.id),
      },
      el(
        'header',
        { class: 'compart__section-head' },
        label,
        kind,
        el(
          'button',
          {
            class: 'compart__remove',
            type: 'button',
            title: 'Delete this section — its lines stay, unassigned',
            onclick: () => this.#removeSection(section.id),
          },
          '✕',
        ),
      ),
      el(
        'div',
        { class: 'compart__section-meta' },
        el(
          'span',
          { class: 'compart__count' },
          lineCount === 0
            ? 'no lines yet'
            : `${lineCount} line${lineCount === 1 ? '' : 's'} · ${timedCount} timed`,
        ),
        this.#artistSelect(
          section.artistId,
          (artistId) => this.#setSectionArtist(section.id, artistId),
          'Whole section: nobody',
        ),
      ),
      occurrences,
      el(
        'div',
        { class: 'compart__section-actions' },
        el(
          'button',
          {
            class: 'compart__occ-add',
            type: 'button',
            title:
              section.occurrences.length === 0
                ? 'Mark where this part happens in the track'
                : 'Mark another place this part comes back — its lines replay, shifted',
            onclick: () => this.#addOccurrence(section),
          },
          section.occurrences.length === 0 ? '＋ Add where it happens' : '＋ It repeats here',
        ),
        this.#selected.size > 0
          ? el(
              'button',
              {
                class: 'compart__assign',
                type: 'button',
                onclick: () => this.#assign(section.id),
              },
              `Put ${this.#selected.size} line${this.#selected.size === 1 ? '' : 's'} here`,
            )
          : null,
      ),
    );
  }

  #occurrenceRow(
    section: LyricSection,
    occurrence: SectionOccurrence,
    index: number,
  ): HTMLElement {
    const time = (
      which: 'startSec' | 'endSec',
      value: number,
      title: string,
    ): HTMLElement => {
      const input = el('input', {
        class: 'compart__time',
        type: 'text',
        value: formatClock(value),
        title,
        'aria-label': title,
        onfocus: () => (this.#editing = true),
        onblur: (event: Event) => {
          this.#editing = false;
          const parsed = parseClock((event.target as HTMLInputElement).value);
          if (parsed === null || parsed === value) {
            (event.target as HTMLInputElement).value = formatClock(value);
            return;
          }
          this.#patchOccurrence(section, occurrence.id, { [which]: parsed });
        },
      }) as HTMLInputElement;
      return input;
    };

    const grab = (which: 'startSec' | 'endSec'): HTMLElement =>
      el(
        'button',
        {
          class: 'compart__grab',
          type: 'button',
          title: `Set the ${which === 'startSec' ? 'start' : 'end'} to where the playhead is now`,
          onclick: () =>
            this.#patchOccurrence(section, occurrence.id, {
              [which]: Math.max(0, this.#store.state.currentTime),
            }),
        },
        '⤓',
      );

    const { referenceIndex, offsets } = occurrenceOffsets(
      section,
      sectionLineTimes(getSheet(), section.id),
    );
    const isReference = index === referenceIndex;
    const offset = offsets[index] ?? 0;

    return el(
      'div',
      { class: `compart__occ${isReference ? ' is-reference' : ''}` },
      el(
        'span',
        {
          class: 'compart__occ-tag',
          title: isReference
            ? 'The performance your tapped timings belong to'
            : `Replays the tapped lines ${formatClock(Math.abs(offset))} ${offset < 0 ? 'earlier' : 'later'}`,
        },
        isReference
          ? 'tapped'
          : `${offset < 0 ? '−' : '+'}${formatClock(Math.abs(offset))}`,
      ),
      time('startSec', occurrence.startSec, 'Start of this occurrence (m:ss)'),
      grab('startSec'),
      el('span', { class: 'compart__occ-dash' }, '–'),
      time('endSec', occurrence.endSec, 'End of this occurrence (m:ss)'),
      grab('endSec'),
      el(
        'button',
        {
          class: 'compart__occ-play',
          type: 'button',
          title: 'Play this occurrence · Shift-click to loop it',
          onclick: (event: Event) => {
            if ((event as MouseEvent).shiftKey) {
              this.#callbacks.onLoop(occurrence.startSec, occurrence.endSec);
            }
            this.#callbacks.onSeek(occurrence.startSec);
            this.#callbacks.onPlay();
          },
        },
        '▶',
      ),
      el(
        'button',
        {
          class: 'compart__remove',
          type: 'button',
          title: 'Remove this occurrence',
          onclick: () =>
            this.#patchSection(section.id, {
              occurrences: section.occurrences.filter((entry) => entry.id !== occurrence.id),
            }),
        },
        '✕',
      ),
    );
  }

  // --- lines ---------------------------------------------------------------

  #renderLines(): void {
    clear(this.#lineList);
    this.#lineRows = [];
    const sheet = getSheet();
    const sections = new Map(this.#sections().map((section) => [section.id, section]));

    if (sheet.lines.length === 0) {
      this.#lineList.appendChild(
        el(
          'p',
          { class: 'compart__empty' },
          'No lyrics yet. Paste them in Annotation first, then come back here to sort them.',
        ),
      );
      return;
    }

    sheet.lines.forEach((line, index) => {
      const section = line.sectionId === undefined ? undefined : sections.get(line.sectionId);
      // The line's own artist wins; failing that it inherits the section's.
      const effective = line.artistId ?? section?.artistId;
      const inherited = line.artistId === undefined && section?.artistId !== undefined;

      const row = el(
        'li',
        {
          class: [
            'compart__line',
            this.#selected.has(index) ? 'is-selected' : '',
            section ? `is-${section.kind}` : 'is-loose',
            line.startSec === null ? 'is-untimed' : '',
          ]
            .filter(Boolean)
            .join(' '),
          title: [
            line.startSec === null ? 'Not timed yet.' : `Timed at ${formatClock(line.startSec)}.`,
            section ? `In ${section.label}.` : 'Not in any section.',
            effective ? `Sung by ${this.#artistName(effective)}${inherited ? ' (from the section)' : ''}.` : '',
            'Click to select · Shift-click for a run · Ctrl-click to add · drag into a section.',
          ]
            .filter(Boolean)
            .join('\n'),
          onclick: (event: Event) => this.#onLineClick(index, event as MouseEvent),
          onpointerdown: (event: Event) => this.#onPointerDown(index, event as PointerEvent),
        },
        el(
          'button',
          {
            class: 'compart__line-time',
            type: 'button',
            title: line.startSec === null ? 'Not timed yet' : 'Play from here',
            onclick: (event: Event) => {
              event.stopPropagation();
              if (line.startSec === null) return;
              this.#callbacks.onSeek(line.startSec);
              this.#callbacks.onPlay();
            },
          },
          line.startSec === null ? '––––' : formatClock(line.startSec),
        ),
        el('span', { class: 'compart__line-text' }, line.text),
        section
          ? el('span', { class: 'compart__line-tag' }, section.label)
          : el('span', { class: 'compart__line-tag is-empty' }, '—'),
        this.#artistSelect(
          line.artistId,
          (artistId) => this.#setLineArtist(index, artistId),
          inherited ? `↳ ${this.#artistName(section?.artistId)}` : 'nobody',
        ),
      );

      this.#lineRows.push(row);
      this.#lineList.appendChild(row);
    });
  }

  #setLineArtist(index: number, artistId: string | undefined): void {
    this.#callbacks.onCommit({
      lines: getSheet().lines.map((line, i) => {
        if (i !== index) return line;
        if (artistId === undefined) {
          const { artistId: _dropped, ...rest } = line;
          return rest;
        }
        return { ...line, artistId };
      }),
    });
    this.#invalidate();
  }

  /**
   * Selection, the way a file list does it.
   *
   * Plain click replaces, shift extends from the anchor, ctrl/cmd toggles one.
   * Sorting a hundred lines into six parts is a lot of clicks otherwise, and a
   * chorus is always a contiguous run — which is exactly what shift is for.
   */
  #onLineClick(index: number, event: MouseEvent): void {
    if (this.#swallowClick) return;
    if ((event.target as HTMLElement).closest('button, select, input')) return;

    if (event.shiftKey && this.#anchor !== null) {
      const [from, to] = this.#anchor <= index ? [this.#anchor, index] : [index, this.#anchor];
      if (!event.ctrlKey && !event.metaKey) this.#selected.clear();
      for (let i = from; i <= to; i += 1) this.#selected.add(i);
    } else if (event.ctrlKey || event.metaKey) {
      if (this.#selected.has(index)) this.#selected.delete(index);
      else this.#selected.add(index);
      this.#anchor = index;
    } else {
      const onlyThis = this.#selected.size === 1 && this.#selected.has(index);
      this.#selected.clear();
      if (!onlyThis) this.#selected.add(index);
      this.#anchor = index;
    }

    this.#invalidate();
    this.#render();
  }

  /**
   * Dragging, on pointer events rather than HTML5 drag-and-drop.
   *
   * The native API looks like the obvious choice and is the wrong one here: it
   * does not fire for touch at all, so the whole feature would be unavailable
   * on a tablet propped next to a keyboard, which is exactly where you would
   * use it. Pointer events cover mouse, touch and pen with one path, and let
   * the dragged thing be a real element that says how many lines you have.
   */
  #onPointerDown(index: number, event: PointerEvent): void {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, select, input')) return;

    this.#drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      index,
      active: false,
      ghost: null,
      target: null,
    };
    window.addEventListener('pointermove', this.#onPointerMove);
    window.addEventListener('pointerup', this.#onPointerUp, { once: true });
    window.addEventListener('pointercancel', this.#onPointerUp, { once: true });
  }

  #onPointerMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.active) {
      const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (travelled < DRAG_THRESHOLD_PX) return;

      // Dragging a line that is not part of the selection means you meant that
      // line, not the ones you picked earlier.
      if (!this.#selected.has(drag.index)) {
        this.#selected = new Set([drag.index]);
        this.#anchor = drag.index;
        this.#invalidate();
        this.#render();
      }
      drag.active = true;
      const count = this.#selected.size;
      drag.ghost = el(
        'div',
        { class: 'compart__ghost' },
        `${count} line${count === 1 ? '' : 's'}`,
      );
      document.body.appendChild(drag.ghost);
      document.body.classList.add('is-dragging-lines');
    }

    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
    }

    // The ghost must not shadow the thing underneath it; its CSS sets
    // pointer-events: none so this lookup sees the drop target.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under?.closest<HTMLElement>('[data-drop]') ?? null;
    if (target !== drag.target) {
      drag.target?.classList.remove('is-drop-target');
      target?.classList.add('is-drop-target');
      drag.target = target;
    }
    event.preventDefault();
  };

  #onPointerUp = (event: PointerEvent): void => {
    window.removeEventListener('pointermove', this.#onPointerMove);
    window.removeEventListener('pointerup', this.#onPointerUp);
    window.removeEventListener('pointercancel', this.#onPointerUp);

    const drag = this.#drag;
    this.#drag = null;
    if (!drag || event.pointerId !== drag.pointerId) return;

    drag.ghost?.remove();
    document.body.classList.remove('is-dragging-lines');
    drag.target?.classList.remove('is-drop-target');

    // Never moved far enough: this was a click, and the click handler has it.
    if (!drag.active) return;

    // It was a drag, so the click that follows must not also change the
    // selection out from under the drop.
    //
    // Cleared on a timer rather than by that click, because when the drag ends
    // over a different element than it began on — the normal case, since the
    // point is to carry a line somewhere — no click is generated at all, and a
    // flag waiting for one would sit armed and swallow the next real click.
    this.#swallowClick = true;
    setTimeout(() => {
      this.#swallowClick = false;
    }, 0);

    const dropped = drag.target?.dataset['drop'];
    if (dropped === undefined) return;
    this.#assign(dropped === '' ? null : dropped);
    this.#render();
  };

  /** Mark an element as somewhere lines can be dropped. */
  #dropHandlers(sectionId: string | null): Record<string, string> {
    return { 'data-drop': sectionId ?? '' };
  }

  // -------------------------------------------------------------------------

  #render(): void {
    this.#renderArtists();
    this.#renderSections();
    this.#renderLines();

    const sheet = getSheet();
    const assigned = sheet.lines.filter((line) => line.sectionId !== undefined).length;
    const total = sheet.lines.length;
    this.#summary.textContent =
      total === 0 ? '' : `${assigned} of ${total} lines placed`;
    this.#unassignedDrop.classList.toggle('is-armed', this.#selected.size > 0);
  }
}

/** "1:23" or "83" or "1:23.5" → seconds. Null when it is not a time at all. */
export function parseClock(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const match = /^(?:(\d+):)?([0-5]?\d(?:\.\d+)?)$/.exec(text);
  if (!match) {
    // A bare number of seconds is a reasonable thing to type.
    const plain = Number(text);
    return Number.isFinite(plain) && plain >= 0 ? plain : null;
  }
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}
