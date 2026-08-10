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
  /** As written — "Verse 2", "Hook". */
  readonly label: string;
  readonly kind: SectionKind;
  /**
   * Set when this section's words were copied from an earlier section with
   * the same name. Writing `[Chorus]` a second time with nothing under it
   * brings the words back without retyping them; only the timings are new.
   */
  readonly repeatOf?: string;
}

export interface LyricLine {
  readonly text: string;
  /** Seconds. `null` until the line has been tapped. */
  readonly startSec: number | null;
  /** Which section this line belongs to. */
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

/**
 * Section headings are matched loosely on their name, so "Hook" == "hook 2"
 * and a repeat can be recognised.
 *
 * Uses the Unicode letter class rather than an ASCII-and-Hangul range: the
 * old version stripped every Japanese, Chinese and accented character, which
 * reduced `[サビ]` to an empty string and made every Japanese heading collide
 * with every other one.
 */
function sectionKey(label: string): string {
  return label.toLowerCase().replace(/[^\p{L}]+/gu, '');
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
 * Derived from the timings you tapped rather than from anything guessed: a
 * section begins at its first timed line and runs until the next section
 * starts. Sections with nothing timed yet are left out, because a section with
 * no position on the timeline is not something you can click to replay.
 */
export function sectionSpans(sheet: LyricSheet, durationSec: number): SectionSpan[] {
  const sections = sheet.sections ?? [];
  if (sections.length === 0) return [];

  const spans = sections
    .map((section) => {
      const lines = sheet.lines.filter((line) => line.sectionId === section.id);
      const timed = lines
        .map((line) => line.startSec)
        .filter((at): at is number => at !== null);
      return {
        section,
        startSec: timed.length > 0 ? Math.min(...timed) : Number.NaN,
        endSec: durationSec,
        lineCount: lines.length,
        timedCount: timed.length,
      };
    })
    .filter((span) => Number.isFinite(span.startSec))
    .sort((a, b) => a.startSec - b.startSec);

  // Each section runs up to the next one. Ordering by time rather than by
  // position in the text matters: a repeated chorus is written late in the
  // sheet but may be tapped anywhere in the song.
  return spans.map((span, index) => ({
    ...span,
    endSec: spans[index + 1]?.startSec ?? durationSec,
  }));
}

export interface ParsedLyrics {
  readonly lines: LyricLine[];
  readonly sections: LyricSection[];
}

/**
 * Parse pasted text into sections and lines.
 *
 * A line in brackets — `[Chorus]`, `(Verse 2)` — is a heading rather than
 * something to sing. Headings were previously discarded; now they organise
 * the sheet, which matters most for the part that repeats: writing `[Hook]` a
 * second time with nothing beneath it brings back the words from the first
 * `[Hook]`, so a chorus that recurs four times is typed once and tapped four
 * times.
 */
export function parseSheet(raw: string, existing?: LyricSheet): ParsedLyrics {
  /**
   * Every occurrence of each line, in order — including the untimed ones.
   *
   * A repeated chorus has the same text in several places, so a plain
   * text→time map cannot tell the second hook from the first. Keeping the
   * occurrences in a queue, nulls and all, means the Nth occurrence of a line
   * gets back the Nth time, which is exactly right whenever the structure has
   * not changed and degrades sensibly when it has.
   */
  const previous = new Map<string, (number | null)[]>();
  const previousTranslations = new Map<string, string>();
  for (const line of existing?.lines ?? []) {
    const seen = previous.get(line.text);
    if (seen) seen.push(line.startSec);
    else previous.set(line.text, [line.startSec]);
    if (line.translation) previousTranslations.set(line.text, line.translation);
  }

  const sections: LyricSection[] = [];
  const lines: LyricLine[] = [];
  /** First section seen under each heading name, for resolving repeats. */
  const firstByKey = new Map<string, string>();
  /** The words belonging to each section, so a repeat can copy them. */
  const wordsBySection = new Map<string, string[]>();
  let current: LyricSection | null = null;

  /** Hand back each remembered time once, to the occurrence it belonged to. */
  const takeTime = (text: string): number | null => previous.get(text)?.shift() ?? null;

  const addLine = (text: string): void => {
    const translation = previousTranslations.get(text);
    lines.push({
      text,
      startSec: takeTime(text),
      ...(current ? { sectionId: current.id } : {}),
      ...(translation ? { translation } : {}),
    });
    if (current) wordsBySection.get(current.id)?.push(text);
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const heading = /^[[(](.+)[\])]$/.exec(line);
    if (heading) {
      const label = (heading[1] ?? '').trim();
      const key = sectionKey(label);
      const id = `sec-${sections.length}`;
      const source = firstByKey.get(key);

      current = {
        id,
        label,
        kind: sectionKindFor(label),
        ...(source ? { repeatOf: source } : {}),
      };
      sections.push(current);
      wordsBySection.set(id, []);
      if (!source) firstByKey.set(key, id);
      continue;
    }

    addLine(line);
  }

  // Any section left empty that names an earlier one inherits its words.
  for (const section of sections) {
    if (!section.repeatOf) continue;
    if ((wordsBySection.get(section.id)?.length ?? 0) > 0) continue;
    const source = wordsBySection.get(section.repeatOf) ?? [];
    if (source.length === 0) continue;

    // Insert the copied lines in the right place: immediately after the
    // heading, which is wherever the next section's lines begin.
    const insertAt = indexAfterSection(lines, sections, section.id);
    const copied = source.map<LyricLine>((text) => ({
      text,
      startSec: takeTime(text),
      sectionId: section.id,
    }));
    lines.splice(insertAt, 0, ...copied);
    wordsBySection.set(section.id, [...source]);
  }

  return { lines, sections };
}

/**
 * The sheet, written back out as the text you would have typed.
 *
 * The editing box needs this to know whether its contents still match the
 * sheet. Comparing against the bare line texts — which is what it used to do —
 * can never match a sheet that has headings, so the box looked permanently
 * out of date and got overwritten with a headingless copy of itself. From
 * there every later edit reparsed text whose structure had already been
 * thrown away, and the sections vanished for good.
 *
 * Round-trips: `parseSheet(sheetToText(s))` reproduces `s`.
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

/** Where a section's lines should go, given the sections that follow it. */
function indexAfterSection(
  lines: readonly LyricLine[],
  sections: readonly LyricSection[],
  sectionId: string,
): number {
  const order = sections.findIndex((section) => section.id === sectionId);
  for (let i = order + 1; i < sections.length; i += 1) {
    const next = sections[i]!.id;
    const at = lines.findIndex((line) => line.sectionId === next);
    if (at >= 0) return at;
  }
  return lines.length;
}

/**
 * Guess the structure of an unmarked lyric sheet.
 *
 * Not audio analysis — just the observation that the chorus is the bit that
 * comes back. A run of consecutive lines appearing more than once in a lyric
 * is almost always the hook, and everything between those runs is a verse.
 *
 * That is a narrow claim, and narrow is the point: it is right most of the
 * time, wrong in obvious ways when it is wrong, and every heading it produces
 * is text you can edit. It cannot find a bridge or an intro, because nothing
 * about the words marks those out — only the music does.
 */
export function suggestSections(lineTexts: readonly string[]): string[] {
  if (lineTexts.length < 4) return [...lineTexts];

  const repeated = findRepeatedBlock(lineTexts);
  const out: string[] = [];

  if (!repeated) {
    // Nothing repeats: call the whole thing one verse rather than inventing
    // divisions that are not there.
    out.push('[Verse 1]', ...lineTexts);
    return out;
  }

  const { length, starts } = repeated;
  const chorusAt = new Set(starts);
  let verseNumber = 0;
  let index = 0;
  let inVerse = false;

  while (index < lineTexts.length) {
    if (chorusAt.has(index)) {
      out.push('[Chorus]');
      for (let i = 0; i < length; i += 1) out.push(lineTexts[index + i]!);
      index += length;
      inVerse = false;
      continue;
    }
    if (!inVerse) {
      verseNumber += 1;
      out.push(`[Verse ${verseNumber}]`);
      inVerse = true;
    }
    out.push(lineTexts[index]!);
    index += 1;
  }

  return out;
}

/** The longest run of lines that occurs more than once, without overlaps. */
function findRepeatedBlock(
  lines: readonly string[],
): { length: number; starts: number[] } | null {
  const maxLength = Math.min(10, Math.floor(lines.length / 2));

  for (let length = maxLength; length >= 2; length -= 1) {
    const seen = new Map<string, number[]>();
    for (let start = 0; start + length <= lines.length; start += 1) {
      const key = lines.slice(start, start + length).join('\n');
      const at = seen.get(key);
      if (at) at.push(start);
      else seen.set(key, [start]);
    }

    for (const [, starts] of seen) {
      if (starts.length < 2) continue;
      // Keep only non-overlapping occurrences.
      const kept: number[] = [];
      let lastEnd = -1;
      for (const start of starts) {
        if (start >= lastEnd) {
          kept.push(start);
          lastEnd = start + length;
        }
      }
      if (kept.length >= 2) return { length, starts: kept };
    }
  }
  return null;
}

/** Split pasted text into lines, dropping blank ones and section headers. */
export function parseLyrics(raw: string, existing?: LyricSheet): LyricLine[] {
  // Carry timings and translations across an edit by matching on line text, so
  // fixing a typo in one line costs you that line and nothing else.
  const previous = new Map<string, number>();
  const previousTranslations = new Map<string, string>();
  for (const line of existing?.lines ?? []) {
    if (line.startSec !== null) previous.set(line.text, line.startSec);
    if (line.translation) previousTranslations.set(line.text, line.translation);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Section markers like [Verse 1] are structure, not words to sing.
    .filter((line) => line.length > 0 && !/^[[(].*[\])]$/.test(line))
    .map((text) => {
      const carried = previous.get(text);
      const translation = previousTranslations.get(text);
      return {
        text,
        startSec: carried ?? null,
        ...(translation ? { translation } : {}),
      };
    });
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

let currentSheet: LyricSheet = emptySheet();

export function setSheet(sheet: LyricSheet): void {
  currentSheet = sheet;
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
