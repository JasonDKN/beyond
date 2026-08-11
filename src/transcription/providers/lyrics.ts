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

/** Somebody who sings on the track. */
export interface Artist {
  readonly id: string;
  readonly name: string;
}

/**
 * One place in the song where a section is performed.
 *
 * A hook that comes back three times is one section with three occurrences,
 * not three sections. That distinction is what lets you type the words once
 * and tap them once: the first occurrence holds the real timings and the
 * others replay them, shifted by the gap between their starts.
 */
export interface SectionOccurrence {
  readonly id: string;
  readonly startSec: number;
  readonly endSec: number;
}

export interface LyricSection {
  readonly id: string;
  /** As written — "Verse 2", "Hook". */
  readonly label: string;
  readonly kind: SectionKind;
  /** Every place this section happens, earliest first. */
  readonly occurrences: readonly SectionOccurrence[];
  /**
   * Who sings it, by default. Individual lines override this, because a verse
   * that trades lines between members is the normal case, not the exception.
   */
  readonly artistId?: string;
}

export interface LyricLine {
  readonly text: string;
  /** Seconds. `null` until the line has been tapped. */
  readonly startSec: number | null;
  /** Which section this line belongs to. */
  readonly sectionId?: string;
  /** Who sings this line, overriding whatever its section says. */
  readonly artistId?: string;
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
  readonly artists?: readonly Artist[];
}

export function emptySheet(language: LanguageTag = 'ko'): LyricSheet {
  return { language, lines: [], audioKey: '', sections: [], artists: [] };
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
  readonly occurrence: SectionOccurrence;
  /** 0 for the reference performance, higher for each repeat. */
  readonly occurrenceIndex: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly lineCount: number;
  readonly timedCount: number;
}

/**
 * Where each section sits in the song.
 *
 * Every span comes from a start and end you set by hand, so the strip under
 * the waveform shows what you said rather than what anything inferred. A
 * section with no occurrences yet simply has no position, and does not appear.
 */
export function sectionSpans(sheet: LyricSheet, durationSec: number): SectionSpan[] {
  const spans: SectionSpan[] = [];

  for (const section of sheet.sections ?? []) {
    const lines = sheet.lines.filter((line) => line.sectionId === section.id);
    const timedCount = lines.filter((line) => line.startSec !== null).length;

    section.occurrences.forEach((occurrence, occurrenceIndex) => {
      const startSec = Math.max(0, Math.min(occurrence.startSec, durationSec));
      const endSec = Math.max(startSec, Math.min(occurrence.endSec, durationSec));
      if (endSec - startSec < 0.01) return;
      spans.push({
        section,
        occurrence,
        occurrenceIndex,
        startSec,
        endSec,
        lineCount: lines.length,
        timedCount,
      });
    });
  }

  return spans.sort((a, b) => a.startSec - b.startSec);
}

/** Slack around an occurrence's edges, for taps that sit just outside it. */
const EDGE_GRACE_SEC = 0.5;

/** Something about a section's placement worth telling you about. */
export interface SectionWarning {
  readonly kind: 'overflows' | 'lands-in';
  readonly occurrenceIndex: number;
  /** For 'lands-in', the section whose block the replayed words fall inside. */
  readonly otherLabel?: string;
  readonly count: number;
}

/**
 * What is wrong with how a section is placed, if anything.
 *
 * Two things are worth catching, and both have the same symptom — words
 * turning up where nobody sings them.
 *
 * A repeat marked somewhere the part does not actually return will replay its
 * words into whatever else is there; that is easy to do by accident, since
 * marking a repeat takes one click at wherever the playhead was sitting.
 * And a repeat whose window is shorter than the part it repeats drops its own
 * tail, which looks like lines going missing.
 *
 * Neither is forbidden — parts do genuinely overlap — so these are reported
 * rather than prevented.
 */
export function sectionWarnings(sheet: LyricSheet, section: LyricSection): SectionWarning[] {
  if (section.occurrences.length < 2) return [];

  const { overflowed } = placeLinesWithOverflow(sheet);
  const warnings: SectionWarning[] = [];

  const overflowHere = new Map<number, number>();
  for (const line of overflowed) {
    if (line.sectionId !== section.id) continue;
    overflowHere.set(line.occurrenceIndex, (overflowHere.get(line.occurrenceIndex) ?? 0) + 1);
  }
  for (const [occurrenceIndex, count] of overflowHere) {
    warnings.push({ kind: 'overflows', occurrenceIndex, count });
  }

  // Where each *other* section is performed, so a repeat landing inside one
  // can name it.
  const elsewhere: { label: string; startSec: number; endSec: number }[] = [];
  for (const other of sheet.sections ?? []) {
    if (other.id === section.id) continue;
    for (const occurrence of other.occurrences) {
      elsewhere.push({ label: other.label, startSec: occurrence.startSec, endSec: occurrence.endSec });
    }
  }

  const { referenceIndex } = occurrenceOffsets(section, sectionLineTimes(sheet, section.id));
  section.occurrences.forEach((occurrence, index) => {
    if (index === referenceIndex) return;
    for (const other of elsewhere) {
      const overlap =
        Math.min(occurrence.endSec, other.endSec) - Math.max(occurrence.startSec, other.startSec);
      if (overlap <= EDGE_GRACE_SEC) continue;
      warnings.push({
        kind: 'lands-in',
        occurrenceIndex: index,
        otherLabel: other.label,
        count: sectionLineTimes(sheet, section.id).length,
      });
      break;
    }
  });

  return warnings;
}

/** The tapped times of the lines placed in a section. */
export function sectionLineTimes(sheet: LyricSheet, sectionId: string): number[] {
  return sheet.lines
    .filter((line) => line.sectionId === sectionId)
    .map((line) => line.startSec)
    .filter((at): at is number => at !== null);
}

/**
 * Which occurrence the tapped timings actually belong to.
 *
 * This used to be assumed to be the first one, and that assumption is wrong
 * whenever you mark an *earlier* performance after tapping a later one — the
 * occurrences sort by time, so the one you tapped stops being first, and every
 * repeat is then measured from the wrong place. The result was lines landing
 * where nothing is sung and no line at all where the section really starts.
 *
 * The reference is the occurrence that actually contains the taps.
 */
export function referenceOccurrenceIndex(
  section: LyricSection,
  lineTimes: readonly number[],
): number {
  if (section.occurrences.length === 0) return -1;
  if (lineTimes.length === 0) return 0;

  let best = -1;
  let bestInside = 0;
  section.occurrences.forEach((occurrence, index) => {
    const inside = lineTimes.filter(
      (at) => at >= occurrence.startSec - EDGE_GRACE_SEC && at <= occurrence.endSec + EDGE_GRACE_SEC,
    ).length;
    if (inside > bestInside) {
      bestInside = inside;
      best = index;
    }
  });
  if (best >= 0) return best;

  // No window holds any tap — the song was timed before it was mapped out.
  // Fall back to whichever occurrence begins nearest the first line.
  const first = Math.min(...lineTimes);
  let nearest = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  section.occurrences.forEach((occurrence, index) => {
    const distance = Math.abs(occurrence.startSec - first);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = index;
    }
  });
  return nearest;
}

/**
 * How much later each performance happens than the one you tapped.
 *
 * The reference occurrence holds real, tapped times. Every other occurrence is
 * the same lines moved along by the distance between the two starts, which is
 * why one tap pass covers a hook that returns four times.
 */
export function occurrenceOffsets(
  section: LyricSection,
  lineTimes: readonly number[],
): { referenceIndex: number; offsets: number[] } {
  const referenceIndex = referenceOccurrenceIndex(section, lineTimes);
  const base = section.occurrences[referenceIndex]?.startSec ?? 0;
  return {
    referenceIndex,
    offsets: section.occurrences.map((occurrence) => occurrence.startSec - base),
  };
}

/** A line placed at one particular moment in the song. */
export interface PlacedLine {
  readonly text: string;
  readonly startSec: number;
  readonly translation?: string;
  readonly artistId?: string;
  /** Index into `sheet.lines` — the line this came from. */
  readonly sourceIndex: number;
  readonly occurrenceIndex: number;
  /** True when this is a repeat replayed from elsewhere, not a tap. */
  readonly isRepeat: boolean;
}

/** A line a repeat could not place, because it fell outside the marked window. */
export interface OverflowedLine {
  readonly sectionId: string;
  readonly occurrenceIndex: number;
  readonly text: string;
  readonly wouldBeAtSec: number;
}

/**
 * Every line, at every moment it is performed.
 *
 * The sheet stores each line once. A section that happens more than once turns
 * one stored line into several placed ones, so the score covers the whole song
 * without you having typed or tapped the chorus four times.
 */
export function placeLines(sheet: LyricSheet): PlacedLine[] {
  return placeLinesWithOverflow(sheet).placed;
}

/**
 * The same, plus whatever a repeat could not fit.
 *
 * A repeat may only put lines inside the window you marked for it. That rule
 * is the whole safeguard against the thing it is easy to do by accident:
 * mark a hook as returning somewhere it does not, and have its words appear
 * in the middle of a verse where nobody sings them. If a replayed line would
 * land outside its own block it is not placed at all — and it is reported, so
 * the interface can say the window is too short rather than quietly losing it.
 */
export function placeLinesWithOverflow(sheet: LyricSheet): {
  placed: PlacedLine[];
  overflowed: OverflowedLine[];
} {
  const sections = new Map((sheet.sections ?? []).map((section) => [section.id, section]));
  const placed: PlacedLine[] = [];
  const overflowed: OverflowedLine[] = [];

  /** Worked out once per section, not once per line. */
  const timingCache = new Map<string, { referenceIndex: number; offsets: number[] }>();
  const timingFor = (section: LyricSection) => {
    const cached = timingCache.get(section.id);
    if (cached) return cached;
    const computed = occurrenceOffsets(section, sectionLineTimes(sheet, section.id));
    timingCache.set(section.id, computed);
    return computed;
  };

  sheet.lines.forEach((line, sourceIndex) => {
    if (line.startSec === null) return;
    const section = line.sectionId === undefined ? undefined : sections.get(line.sectionId);
    const artistId = line.artistId ?? section?.artistId;

    const at = (startSec: number, occurrenceIndex: number, isRepeat: boolean): PlacedLine => ({
      text: line.text,
      startSec,
      sourceIndex,
      occurrenceIndex,
      isRepeat,
      ...(line.translation === undefined ? {} : { translation: line.translation }),
      ...(artistId === undefined ? {} : { artistId }),
    });

    // No section, or a section performed once: the line sits where it was
    // tapped and nothing is duplicated.
    if (!section || section.occurrences.length < 2) {
      placed.push(at(line.startSec, 0, false));
      return;
    }

    const { referenceIndex, offsets } = timingFor(section);

    section.occurrences.forEach((occurrence, index) => {
      // The performance you tapped keeps its literal times, whatever window
      // you drew around it — the taps are the ground truth there.
      if (index === referenceIndex) {
        placed.push(at(line.startSec!, index, false));
        return;
      }

      const startSec = line.startSec! + (offsets[index] ?? 0);
      /*
       * Only the end is a real constraint.
       *
       * A repeat is a rigid shift, so a line that sat just before the
       * reference window's start sits just before this one's too — symmetric,
       * consistent, and not worth policing. Running past the end is different:
       * it means the window is shorter than the part it repeats, and the tail
       * would land in whatever comes next.
       */
      if (startSec > occurrence.endSec + EDGE_GRACE_SEC) {
        overflowed.push({
          sectionId: section.id,
          occurrenceIndex: index,
          text: line.text,
          wouldBeAtSec: startSec,
        });
        return;
      }
      placed.push(at(startSec, index, true));
    });
  });

  return { placed: placed.sort((a, b) => a.startSec - b.startSec), overflowed };
}

/** Text in brackets is a marker someone typed, not something to sing. */
export function isMarkerLine(line: string): boolean {
  return /^[[(].*[\])]$/.test(line);
}

/**
 * Split pasted text into lines.
 *
 * Everything a line carries besides its words — its timing, its translation,
 * which section it was dropped into, who sings it — is attached in the app,
 * not in the text. So an edit has to hand all of that back, or fixing one
 * typo would undo an evening of sorting.
 *
 * The carry-over is per occurrence, in order: the third "same" line gets back
 * what the third one had. A plain text→value map cannot tell one performance
 * of a repeated line from another, which is how timings used to end up
 * shuffled onto the wrong lines.
 *
 * Bracketed markers are dropped rather than turned into sections. Sections are
 * made by hand in Compartmentalize now — nothing about the song is guessed —
 * but `[Verse 1]` is still not a lyric, and putting it on the staff to be
 * pronounced would be worse than leaving it out.
 */
export function parseLyrics(raw: string, existing?: LyricSheet): LyricLine[] {
  const carried = new Map<string, LyricLine[]>();
  for (const line of existing?.lines ?? []) {
    const seen = carried.get(line.text);
    if (seen) seen.push(line);
    else carried.set(line.text, [line]);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isMarkerLine(line))
    .map((text) => {
      const before = carried.get(text)?.shift();
      return {
        text,
        startSec: before?.startSec ?? null,
        ...(before?.translation === undefined ? {} : { translation: before.translation }),
        ...(before?.sectionId === undefined ? {} : { sectionId: before.sectionId }),
        ...(before?.artistId === undefined ? {} : { artistId: before.artistId }),
      };
    });
}

/** How many bracketed markers the paste contained, so the panel can say so. */
export function countMarkerLines(raw: string): number {
  return raw.split(/\r?\n/).filter((line) => isMarkerLine(line.trim())).length;
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

/**
 * Bring a sheet saved by an older version up to the current shape.
 *
 * Sections used to have no explicit position — one began at its first timed
 * line and ran until the next began — and a repeated chorus was a second
 * section carrying a copy of the words. Both are now expressed the same way:
 * one section, several occurrences.
 *
 * So a repeat is folded back into the section it copied, its duplicated lines
 * are dropped, and the moment it happened survives as an occurrence. Work
 * already done stays done, and nothing needs re-tapping.
 *
 * Idempotent — a sheet already in the new shape passes straight through.
 */
export function upgradeSheet(sheet: LyricSheet): LyricSheet {
  const sections = sheet.sections ?? [];
  const legacy = sections as readonly (LyricSection & { repeatOf?: string })[];
  const needsWork = legacy.some(
    (section) => !Array.isArray(section.occurrences) || section.repeatOf !== undefined,
  );
  if (!needsWork) return sheet;

  /** When each section was performed, from the lines that were tapped. */
  const windowFor = (sectionId: string): { startSec: number; endSec: number } | null => {
    const times = sheet.lines
      .filter((line) => line.sectionId === sectionId)
      .map((line) => line.startSec)
      .filter((at): at is number => at !== null);
    if (times.length === 0) return null;
    return {
      startSec: Math.min(...times),
      // The old model had no end at all. Half a bar past the last line is a
      // guess, but a visible, editable one — better than a section with no
      // extent, which cannot be clicked or looped.
      endSec: Math.max(...times) + TRAILING_LINE_SEC,
    };
  };

  /** The words of a section, in order. */
  const wordsOf = (sectionId: string): string[] =>
    sheet.lines.filter((line) => line.sectionId === sectionId).map((line) => line.text);

  const kept: LyricSection[] = [];
  const byId = new Map<string, LyricSection>();
  /** Repeat section id → the section it folds into. */
  const folded = new Map<string, string>();

  for (const section of legacy) {
    const target = section.repeatOf ? (folded.get(section.repeatOf) ?? section.repeatOf) : null;
    const host = target === null ? undefined : byId.get(target);
    const window = windowFor(section.id);

    /*
     * Only fold a repeat that really is one.
     *
     * The old parser matched headings on their letters alone, so "Verse 2" was
     * recorded as a repeat of "Verse 1" — harmless then, because a section
     * with its own words kept them. Folding on that flag alone is not
     * harmless: it deletes the second verse and replays the first one in its
     * place, which is words appearing where nobody sings them and words
     * vanishing from where they belong.
     *
     * A real repeat carries a copy of the host's words, or none at all.
     */
    const ownWords = wordsOf(section.id);
    const hostWords = host ? wordsOf(host.id) : [];
    const isCopy =
      ownWords.length === 0 ||
      (ownWords.length === hostWords.length && ownWords.every((w, i) => w === hostWords[i]));

    if (host && isCopy) {
      folded.set(section.id, host.id);
      if (window) {
        const merged: LyricSection = {
          ...host,
          occurrences: [...host.occurrences, { id: freshId('occ'), ...window }],
        };
        byId.set(host.id, merged);
        kept[kept.indexOf(host)] = merged;
      }
      continue;
    }

    const { repeatOf: _dropped, ...rest } = section;
    const upgraded: LyricSection = {
      ...rest,
      occurrences: Array.isArray(section.occurrences)
        ? section.occurrences
        : window
          ? [{ id: freshId('occ'), ...window }]
          : [],
    };
    kept.push(upgraded);
    byId.set(upgraded.id, upgraded);
  }

  // A repeat's lines were copies of the section it repeated, so now that the
  // repeat is an occurrence rather than a section, those copies are duplicates.
  const lines = sheet.lines.filter(
    (line) => line.sectionId === undefined || !folded.has(line.sectionId),
  );

  return {
    ...sheet,
    lines,
    sections: kept.map((section) => byId.get(section.id) ?? section),
    artists: sheet.artists ?? [],
  };
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
    //
    // A section performed more than once contributes its lines at each
    // occurrence, so the score covers the whole song even though the chorus
    // was typed and tapped exactly once.
    const timed = placeLines(currentSheet);

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
        id: `line-${line.sourceIndex}-${line.occurrenceIndex}`,
        text: line.text,
        startSec: line.startSec,
        endSec,
        ...(line.translation ? { translation: line.translation } : {}),
        ...(line.isRepeat ? { isRepeat: true } : {}),
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
