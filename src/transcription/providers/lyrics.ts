import type { LanguageTag, Transcript, TranscriptSegment } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import { interpolateWordTimings, progressReporter, TranscriptionError } from '../provider';

/**
 * The lyric sheet: words you supply, timings you tap.
 *
 * Speech recognition is the wrong tool for learning a song you already have the
 * words to. You are not trying to find out what was sung — that is printed in
 * the liner notes. You are trying to find out how it is pronounced, where it
 * lands, and what it means. Whisper only guesses at the first of those, and on
 * fast rap over a dense mix it guesses badly.
 *
 * So this provider inverts the problem. You paste the lyrics, tap once per line
 * as the track plays, and the result is a transcript that is correct by
 * construction — no model, no confidence score, nothing to second-guess. Three
 * minutes of tapping beats an hour of correcting a machine.
 *
 * It implements the same `TranscriptionProvider` interface as Whisper, so
 * everything downstream — phonemizer, staff, inspector, export — cannot tell
 * the difference and needed no changes at all.
 */

/** The parts a song is built from. */
export type SectionKind =
  | 'intro'
  | 'verse'
  | 'pre-chorus'
  | 'chorus'
  | 'post-chorus'
  | 'bridge'
  | 'refrain'
  | 'outro'
  | 'other';

export interface LyricSection {
  readonly id: string;
  /** The heading exactly as written — "Pre-Chorus: V, Jung Kook". */
  readonly label: string;
  /** Just the part it names — "Pre-Chorus". */
  readonly name: string;
  /** Whoever the heading credits, in the order written. */
  readonly artists: readonly string[];
  readonly kind: SectionKind;
}

export interface LyricLine {
  readonly text: string;
  /** Seconds. `null` until the line has been tapped. */
  readonly startSec: number | null;
  /** Which section this line falls under, from the heading above it. */
  readonly sectionId?: string;
  /**
   * What the line means, in your own words.
   *
   * Supplied by you, like the lyrics themselves — Beyond ships no translations
   * and fetches none. Typing your own is also the better way to learn it: a
   * translation you had to think about sticks, and one you skimmed does not.
   */
  readonly translation?: string;
}

export interface LyricSheet {
  readonly language: LanguageTag;
  readonly lines: readonly LyricLine[];
  /** Identifies which audio file these timings belong to. */
  readonly audioKey: string;
  readonly sections?: readonly LyricSection[];
}

export function emptySheet(language: LanguageTag = 'ko'): LyricSheet {
  return { language, lines: [], audioKey: '', sections: [] };
}

/** Ids that do not collide across a session, without pulling in a uuid library. */
let idCounter = 0;
export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Section headings, in the languages lyric sheets actually come in.
 *
 * K-pop sheets are routinely mixed: an English `[Verse 1]` next to a Korean
 * `[후렴]`, sometimes both on the same page. Japanese sheets use サビ for the
 * chorus and Aメロ/Bメロ where English would say verse and pre-chorus — terms
 * with no English cognate at all, so recognising them cannot be done by
 * transliteration.
 *
 * Order matters throughout: `pre-chorus` and `post-chorus` must be tested
 * before `chorus`, since they contain it.
 */
const SECTION_PATTERNS: readonly { kind: SectionKind; pattern: RegExp }[] = [
  {
    kind: 'pre-chorus',
    // 프리코러스 / 프리훅, Bメロ (the build into the chorus)
    pattern: /pre[\s-]?(chorus|hook)|프리\s?(코러스|훅)|b\s?メロ|pré[\s-]?refrain/i,
  },
  {
    kind: 'post-chorus',
    pattern: /post[\s-]?(chorus|hook)|포스트\s?(코러스|훅)|落ちサビ/i,
  },
  {
    kind: 'chorus',
    // 후렴 (refrain), 훅, 코러스; サビ; 副歌; estribillo/coro; refrão/refren.
    // English "refrain" is deliberately absent — it has its own kind below,
    // and listing it here would shadow that rule. Its Romance cousins do not
    // carry the same distinction, so they belong to the chorus.
    pattern: /chorus|hook|후렴|훅|코러스|사비|サビ|副歌|estribillo|\bcoro\b|refrão|refren/i,
  },
  {
    kind: 'verse',
    // 절, 벌스, 버스; Aメロ; 主歌; couplet; strophe; verso
    pattern: /verse|벌스|버스|(^|\W)절(\W|$)|a\s?メロ|主歌|couplet|strophe|verso|estrofa/i,
  },
  {
    kind: 'bridge',
    pattern: /bridge|브(릿|리)지|ブリッジ|桥段|橋段|puente|pont\b|brücke/i,
  },
  {
    kind: 'intro',
    // 간주 and 間奏 are interludes; grouped with intro as instrumental breaks.
    pattern: /intro|인트로|도입|간주|イントロ|間奏|前奏|introducción/i,
  },
  {
    kind: 'outro',
    pattern: /outro|ending|아웃(트)?로|엔딩|アウトロ|尾奏|終わり|final/i,
  },
  { kind: 'refrain', pattern: /refrain|리프레인/i },
];

/** Work out what kind of part a section heading names. */
export function sectionKindFor(label: string): SectionKind {
  for (const { kind, pattern } of SECTION_PATTERNS) {
    if (pattern.test(label)) return kind;
  }
  return 'other';
}

export interface SectionSpan {
  readonly section: LyricSection;
  readonly startSec: number;
  readonly endSec: number;
  readonly lineCount: number;
  readonly timedCount: number;
}

/**
 * Where each section sits in the song.
 *
 * A section begins at its first tapped line and runs until the next one
 * begins. Nothing is placed by hand and nothing is guessed: the heading says
 * what the part is, and your taps say when it happens.
 *
 * A section with nothing tapped yet has no position, so it does not appear —
 * there is no moment to send you to.
 */
export function sectionSpans(sheet: LyricSheet, durationSec: number): SectionSpan[] {
  const spans = (sheet.sections ?? [])
    .map((section) => {
      const lines = sheet.lines.filter((line) => line.sectionId === section.id);
      const timed = lines.map((line) => line.startSec).filter((at): at is number => at !== null);
      return {
        section,
        startSec: timed.length > 0 ? Math.min(...timed) : Number.NaN,
        endSec: durationSec,
        lineCount: lines.length,
        timedCount: timed.length,
      };
    })
    .filter((span) => Number.isFinite(span.startSec))
    // By time rather than by position in the text: a sheet can be edited out
    // of order, and the strip has to agree with the song.
    .sort((a, b) => a.startSec - b.startSec);

  return spans.map((span, index) => ({
    ...span,
    endSec: Math.min(spans[index + 1]?.startSec ?? durationSec, durationSec),
  }));
}

export interface ParsedLyrics {
  readonly lines: LyricLine[];
  readonly sections: LyricSection[];
}

/** Text in brackets is a heading someone typed, not something to sing. */
export function isHeadingLine(line: string): boolean {
  return /^[[(].*[\])]$/.test(line.trim());
}

/**
 * Read a heading into the part it names and the people it credits.
 *
 * Lyric sheets write these as `[Pre-Chorus: V, Jung Kook, Jin, Jimin]` — the
 * part before the colon is what the section *is*, and everything after it is
 * who takes it. Splitting them matters twice over: the button under the
 * waveform can show a short name instead of a line of credits, and the kind is
 * decided from the part name alone, so a member called Hope is never mistaken
 * for a hook.
 */
export function parseHeading(raw: string): { label: string; name: string; artists: string[] } {
  const label = raw.trim();
  const colon = label.search(/[:\uFF1A]/);
  if (colon < 0) return { label, name: label, artists: [] };

  const name = label.slice(0, colon).trim();
  const artists = label
    .slice(colon + 1)
    .split(/[,&\u3001\uFF0C]|\s+and\s+/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return { label, name: name || label, artists };
}

/**
 * Parse pasted text into sections and lines.
 *
 * A line in brackets — `[Chorus]`, `[Intro: j-hope]` — is a heading rather
 * than something to sing, and every line under it belongs to that part. That
 * is the whole of the section feature: paste a lyric sheet written the way
 * lyric sheets are written, and the parts come with it.
 *
 * Each heading stands on its own. An earlier version tried to notice that two
 * headings named the same part and treat the second as a repeat of the first,
 * which is how `[Verse 2]` came to be recorded as a repeat of `[Verse 1]` and,
 * later, to have its words replaced by them. A hook that returns three times
 * is simply written three times, as it is in every lyric sheet ever printed.
 */
export function parseSheet(raw: string, existing?: LyricSheet): ParsedLyrics {
  const carried = carriedLines(existing);

  const sections: LyricSection[] = [];
  const lines: LyricLine[] = [];
  let current: LyricSection | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const heading = /^[[(](.+)[\])]$/.exec(line);
    if (heading) {
      const { label, name, artists } = parseHeading(heading[1] ?? '');
      current = {
        id: `sec-${sections.length}`,
        label,
        name,
        artists,
        kind: sectionKindFor(name),
      };
      sections.push(current);
      continue;
    }

    const before = carried.get(line)?.shift();
    lines.push({
      text: line,
      startSec: before?.startSec ?? null,
      ...(current ? { sectionId: current.id } : {}),
      ...(before?.translation === undefined ? {} : { translation: before.translation }),
    });
  }

  return { lines, sections };
}

/**
 * Every occurrence of each line in the previous sheet, in order.
 *
 * A repeated chorus has the same words in several places, so a plain
 * text-to-value map cannot tell the second hook from the first. Keeping the
 * occurrences in a queue means the Nth occurrence of a line gets back what the
 * Nth one had, which is right whenever the structure has not changed and
 * degrades sensibly when it has.
 */
function carriedLines(existing?: LyricSheet): Map<string, LyricLine[]> {
  const carried = new Map<string, LyricLine[]>();
  for (const line of existing?.lines ?? []) {
    const seen = carried.get(line.text);
    if (seen) seen.push(line);
    else carried.set(line.text, [line]);
  }
  return carried;
}

/**
 * The sheet, written back out as the text you would have typed.
 *
 * The editing box needs this to know whether its contents still match the
 * sheet. Comparing against the bare line texts cannot match a sheet that has
 * headings, and the box then gets overwritten with a headingless copy of
 * itself — which is how the headings, and with them every section, used to
 * disappear the moment you started tapping.
 */
export function sheetToText(sheet: LyricSheet): string {
  const sections = sheet.sections ?? [];
  if (sections.length === 0) return sheet.lines.map((line) => line.text).join('\n');

  const out: string[] = [];
  const byId = new Map<string, string[]>();
  for (const section of sections) byId.set(section.id, []);

  // Anything before the first heading has no section and stays at the top.
  for (const line of sheet.lines) {
    const bucket = line.sectionId === undefined ? undefined : byId.get(line.sectionId);
    if (bucket) bucket.push(line.text);
    else out.push(line.text);
  }

  for (const section of sections) {
    out.push(`[${section.label}]`);
    out.push(...(byId.get(section.id) ?? []));
  }
  return out.join('\n');
}

/** Split pasted text into lines alone, ignoring any headings. */
export function parseLyrics(raw: string, existing?: LyricSheet): LyricLine[] {
  return parseSheet(raw, existing).lines;
}

/** A stable key for localStorage, so timings survive a reload. */
export function audioKeyFor(name: string, durationSec: number): string {
  return `${name}::${durationSec.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Persistence — tapping a song out is real work and should never be lost.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'beyond.sheet.';

export function saveSheet(sheet: LyricSheet): void {
  if (!sheet.audioKey) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + sheet.audioKey, JSON.stringify(sheet));
  } catch {
    // Quota or private browsing. Losing saved timings is bad; crashing is worse.
  }
}

export function loadSheet(audioKey: string): LyricSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + audioKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as LyricSheet;
    if (!Array.isArray(candidate.lines)) return null;
    return candidate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

/** How a section looked in versions that placed parts by hand. */
interface LegacySection {
  readonly id: string;
  readonly label?: string;
  readonly name?: string;
  readonly kind?: SectionKind;
  readonly artists?: readonly string[];
  readonly artistId?: string;
  readonly repeatOf?: string;
  readonly occurrences?: readonly { id: string; startSec: number; endSec: number }[];
}

/**
 * Bring a sheet saved by an older version up to the current shape.
 *
 * Sections have been through two other models. One matched headings by name
 * and copied a repeat's words from the section it repeated; the next dropped
 * headings entirely and had you place each part on the timeline by hand, with
 * a repeated part stored once and replayed at every occurrence you marked.
 *
 * Both are expressible here, and the rule for converting them is the same:
 * whatever the score contained before must contain the same words at the same
 * moments afterwards. So a part that was replayed is written out — the lines
 * it generated become real lines under their own heading, at the times they
 * were playing at. Nothing is recomputed and nothing is dropped; a repeat that
 * you never placed simply has no lines to write.
 *
 * Idempotent: a sheet already in this shape is returned untouched.
 */
export function upgradeSheet(sheet: LyricSheet): LyricSheet {
  const sections = (sheet.sections ?? []) as readonly LegacySection[];
  const needsWork = sections.some(
    (section) =>
      section.occurrences !== undefined ||
      section.repeatOf !== undefined ||
      section.artistId !== undefined ||
      section.name === undefined,
  );
  if (!needsWork) return sheet;

  /** A heading, rebuilt so the credits you recorded survive in the text. */
  const headingFor = (section: LegacySection, artistNames: readonly string[]): string => {
    const written = section.label ?? section.name ?? 'Section';
    // Already carries its credits after a colon: leave it exactly as typed.
    if (/[:\uFF1A]/.test(written) || artistNames.length === 0) return written;
    return `${written}: ${artistNames.join(', ')}`;
  };

  const artistNames = new Map(
    ((sheet as { artists?: readonly { id: string; name: string }[] }).artists ?? []).map(
      (artist) => [artist.id, artist.name],
    ),
  );
  const namesFor = (section: LegacySection): string[] => {
    const found = new Set<string>();
    for (const line of sheet.lines) {
      if (line.sectionId !== section.id) continue;
      const id = (line as { artistId?: string }).artistId ?? section.artistId;
      const name = id === undefined ? undefined : artistNames.get(id);
      if (name) found.add(name);
    }
    if (found.size === 0 && section.artistId !== undefined) {
      const name = artistNames.get(section.artistId);
      if (name) found.add(name);
    }
    return [...found];
  };

  /** One heading and the lines beneath it. */
  interface Block {
    label: string;
    lines: LyricLine[];
    /** For ordering: when this block is performed, if known. */
    startSec: number;
  }

  const blocks: Block[] = [];
  const loose: LyricLine[] = sheet.lines.filter((line) => line.sectionId === undefined);

  for (const section of sections) {
    const own = sheet.lines
      .filter((line) => line.sectionId === section.id)
      .map((line) => {
        // The per-line artist becomes part of the heading; the line keeps only
        // what the new model has a place for.
        const { sectionId: _s, ...rest } = line as LyricLine & { artistId?: string };
        const { artistId: _a, ...clean } = rest as LyricLine & { artistId?: string };
        return clean as LyricLine;
      });
    if (own.length === 0) continue;

    const label = headingFor(section, namesFor(section));
    const timed = own.map((line) => line.startSec).filter((at): at is number => at !== null);
    const occurrences = section.occurrences ?? [];

    // No hand-placed repeats: the part is written once, where it already was.
    if (occurrences.length < 2) {
      blocks.push({
        label,
        lines: own,
        startSec: timed.length > 0 ? Math.min(...timed) : Number.POSITIVE_INFINITY,
      });
      continue;
    }

    /*
     * A part that was replayed. Work out which occurrence held the real taps,
     * then write every other one out as its own heading with its own lines at
     * the times they were actually sounding.
     */
    const base = referenceOccurrence(occurrences, timed);
    occurrences.forEach((occurrence, index) => {
      const offset = occurrence.startSec - (occurrences[base]?.startSec ?? 0);
      if (index === base) {
        blocks.push({
          label,
          lines: own,
          startSec: timed.length > 0 ? Math.min(...timed) : occurrence.startSec,
        });
        return;
      }
      const shifted = own
        .filter((line) => line.startSec !== null)
        // Only what was actually being placed: a line past the end of the
        // window was not in the score, so it does not become one now.
        .filter((line) => line.startSec! + offset <= occurrence.endSec + 0.5)
        .map((line) => ({ ...line, startSec: line.startSec! + offset }));
      if (shifted.length === 0) return;
      blocks.push({ label, lines: shifted, startSec: occurrence.startSec });
    });
  }

  blocks.sort((a, b) => a.startSec - b.startSec);

  const rebuilt: LyricSection[] = [];
  const lines: LyricLine[] = [...loose];
  blocks.forEach((block) => {
    const { label, name, artists } = parseHeading(block.label);
    const section: LyricSection = {
      id: `sec-${rebuilt.length}`,
      label,
      name,
      artists,
      kind: sectionKindFor(name),
    };
    rebuilt.push(section);
    for (const line of block.lines) lines.push({ ...line, sectionId: section.id });
  });

  const { artists: _dropped, ...rest } = sheet as LyricSheet & { artists?: unknown };
  return { ...rest, lines, sections: rebuilt };
}

/** Which of a hand-placed part's occurrences the tapped times belonged to. */
function referenceOccurrence(
  occurrences: readonly { startSec: number; endSec: number }[],
  lineTimes: readonly number[],
): number {
  if (lineTimes.length === 0) return 0;
  let best = -1;
  let bestInside = 0;
  occurrences.forEach((occurrence, index) => {
    const inside = lineTimes.filter(
      (at) => at >= occurrence.startSec - 0.5 && at <= occurrence.endSec + 0.5,
    ).length;
    if (inside > bestInside) {
      bestInside = inside;
      best = index;
    }
  });
  if (best >= 0) return best;

  const first = Math.min(...lineTimes);
  let nearest = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  occurrences.forEach((occurrence, index) => {
    const distance = Math.abs(occurrence.startSec - first);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = index;
    }
  });
  return nearest;
}

let currentSheet: LyricSheet = emptySheet();

export function setSheet(sheet: LyricSheet): void {
  currentSheet = upgradeSheet(sheet);
}

export function getSheet(): LyricSheet {
  return currentSheet;
}

/** How long the final line runs for, when there is no next tap to bound it. */
const TRAILING_LINE_SEC = 6;

class LyricSheetProvider implements TranscriptionProvider {
  readonly id = 'lyrics';
  readonly label = 'My lyrics + tapped timing';
  readonly description =
    'You paste the words and tap along once per line. Exact, offline, and it handles rap no model can follow.';
  readonly requiresApiKey = false;
  readonly isLocal = true;

  async available(): Promise<{ ok: boolean; reason?: string }> {
    const timed = currentSheet.lines.filter((line) => line.startSec !== null);
    if (currentSheet.lines.length === 0) {
      return { ok: false, reason: 'Paste the lyrics first, then tap along to time them.' };
    }
    if (timed.length === 0) {
      return { ok: false, reason: 'No lines are timed yet — play the track and tap each line.' };
    }
    return { ok: true };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    report(0.5, 'Building the score from your lyric sheet…');

    // Only timed lines can be placed on the staff. Untimed ones are held back
    // rather than dropped — the panel keeps showing them as needing a tap.
    const timed = currentSheet.lines
      .map((line, index) => ({ ...line, index }))
      .filter(
        (line): line is { text: string; startSec: number; translation?: string; index: number } =>
          line.startSec !== null,
      )
      .sort((a, b) => a.startSec - b.startSec);

    if (timed.length === 0) {
      throw new TranscriptionError('No lines have been timed yet.', this.id);
    }

    const segments: TranscriptSegment[] = timed.map((line, i) => {
      const next = timed[i + 1];
      const endSec = Math.min(
        next ? next.startSec : line.startSec + TRAILING_LINE_SEC,
        request.audio.durationSec,
      );
      return {
        id: `line-${line.index}`,
        text: line.text,
        startSec: line.startSec,
        endSec,
        ...(line.translation ? { translation: line.translation } : {}),
        // Within a line, words are spaced by character count. Korean is
        // syllable-timed, so this is a better approximation there than it is
        // for a stress-timed language like English.
        //
        // Confidence is 1: you typed these words. There is no model to doubt,
        // and marking them uncertain would be inventing a doubt that does not
        // exist.
        words: interpolateWordTimings(line.text, line.startSec, endSec).map((word) => ({
          ...word,
          confidence: 1,
        })),
      };
    });

    report(1, 'Score ready');

    return {
      language: request.language === 'auto' ? currentSheet.language : request.language,
      languageDetected: false,
      segments,
      providerId: this.id,
      modelId: 'user-supplied',
    };
  }
}

export const lyricsProvider = new LyricSheetProvider();
