/**
 * Where the words of a line fall, once you know where the line falls.
 *
 * Tapping gives one honest number per line — the moment it began. Everything
 * between two taps has to be reasoned about, and the reasoning used to be a
 * single line of code: spread the words evenly by letter count from this
 * line's tap to the next line's tap.
 *
 * That is wrong twice over, and the error grows with the length of the line.
 *
 * The first mistake is the end. A line does not run until the next one starts;
 * it runs until the singer stops singing it. Between the two sits a breath, a
 * bar of instrumental, the gap before a verse answers a hook. Handing that
 * silence to the line stretches every word in it, and because the stretch is
 * proportional, the last word of a long line can land seconds late while the
 * first still looks fine — exactly the symptom of highlighting that drifts
 * further out the longer the line is.
 *
 * The fix is to estimate how long the line was actually sung. The song itself
 * says: across all its lines, some are followed immediately by the next, and
 * those reveal the rate the singer moves at. Take a low quantile of
 * seconds-per-syllable — low, because a line followed by silence can only ever
 * overstate it — and a line's span becomes its own syllable count times that
 * rate, capped at where the next line begins.
 *
 * The second mistake is the unit. Letters are a poor clock: 곳 and "thoughts"
 * are one syllable each and eight letters apart. Counting syllables instead —
 * one per hangul block or kana, vowel groups in an alphabetic word — measures
 * the thing that actually takes time to sing.
 *
 * Both are still estimates. `wordTimings` therefore accepts anchors: real
 * times for individual words, tapped by the person learning the song, which
 * are treated as fixed points with everything between them interpolated. One
 * anchor in the middle of a long line halves the worst error; a few make the
 * line exact. That is what Beatmap's word timing writes.
 */

export interface TimedWord {
  readonly text: string;
  readonly startSec: number;
  readonly endSec: number;
}

/** Seconds per syllable when the song has given us nothing to measure. */
const DEFAULT_RATE = 0.22;
/** Nobody sings faster than this for a whole line, however fast the rap. */
const FASTEST_RATE = 0.08;
/** Nor slower — beyond this the estimate is being led by a mistimed tap. */
const SLOWEST_RATE = 0.55;
/**
 * Which quantile of the observed rates to trust.
 *
 * The distribution is skewed by construction: gaps after a line inflate its
 * apparent rate, and nothing deflates it except a late tap on the following
 * line. The lower part of the distribution is therefore the honest part.
 */
const RATE_QUANTILE = 0.35;
/**
 * Room for the estimate to be wrong in the safer direction.
 *
 * A line that ends slightly late leaves a word highlighted into the silence
 * after it, which reads as a held note. A line that ends early drops the
 * highlight off the last word while it is still being sung, which reads as a
 * bug. So the estimate is stretched a little before it is capped.
 */
const SLACK = 1.3;
/** No line is shorter than this, whatever the arithmetic says. */
const MIN_LINE_SEC = 0.4;

const HANGUL = /[가-힣]/;
const KANA = /[ぁ-ゟァ-ヿㇰ-ㇿ]/;
/** Small kana ride on the preceding mora rather than taking one of their own. */
const SMALL_KANA = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ]/;
const IDEOGRAPH = /[㐀-䶿一-鿿豈-﫿]/;
const VOWEL_RUN = /[aeiouyàáâäåèéêëìíîïòóôöøùúûüýæœаеёиоуыэюяіїєåäö]+/g;

/**
 * How many syllables' worth of singing a piece of text is.
 *
 * Deliberately crude for alphabetic words — vowel groups, minus a silent final
 * e — because the alternative is a pronouncing dictionary, and the answer only
 * has to be better than counting letters. For the syllabaries it is exact,
 * which is the case that matters most here: a Korean lyric is where the letter
 * count goes furthest wrong.
 */
export function unitCount(text: string): number {
  let units = 0;
  let run = '';

  const flush = (): void => {
    if (run.length > 0) {
      units += alphabeticSyllables(run);
      run = '';
    }
  };

  for (const character of text) {
    if (HANGUL.test(character) || IDEOGRAPH.test(character)) {
      flush();
      units += 1;
    } else if (KANA.test(character)) {
      flush();
      if (!SMALL_KANA.test(character)) units += 1;
    } else if (/\p{L}/u.test(character)) {
      run += character;
    } else if (/\p{Nd}/u.test(character)) {
      flush();
      units += 1;
    } else {
      flush();
    }
  }
  flush();
  return units;
}

function alphabeticSyllables(word: string): number {
  const lower = word.toLowerCase();
  const groups = lower.match(VOWEL_RUN);
  let count = groups ? groups.length : 0;
  /*
   * A final e is usually a spelling convention rather than a beat: "while" is
   * one syllable, not two.
   *
   * The exception is a syllabic l — "table", "little" — where the e really is
   * a second beat. What separates them is the letter before the l: a
   * consonant there ("b·le") makes the l syllabic, a vowel ("i·le") does not.
   */
  if (count > 1 && /[^aeiouy]e$/.test(lower) && !/[^aeiouy]le$/.test(lower)) count -= 1;
  return Math.max(1, count);
}

/** One line's observed pace: how many syllables, and how long until the next. */
export interface RateSample {
  readonly units: number;
  readonly availableSec: number;
}

/**
 * The song's own singing rate, in seconds per syllable.
 *
 * Measured from the lines whose neighbours crowd them, since those are the
 * ones whose available time is all singing. Lines with silence after them are
 * still included — throwing them out would need a rule for deciding which they
 * are, which is the very thing being computed — but the quantile leaves them
 * where they belong, at the top of the distribution and out of the answer.
 */
export function syllableRate(samples: readonly RateSample[]): number {
  const rates = samples
    .filter((sample) => sample.units > 0 && sample.availableSec > 0.05)
    .map((sample) => sample.availableSec / sample.units)
    .sort((a, b) => a - b);

  if (rates.length === 0) return DEFAULT_RATE;
  const at = Math.min(rates.length - 1, Math.floor(rates.length * RATE_QUANTILE));
  return Math.min(SLOWEST_RATE, Math.max(FASTEST_RATE, rates[at]!));
}

/**
 * Where a line stops being sung.
 *
 * `boundarySec` is where it must stop regardless — the next line's tap, or the
 * end of the song. The estimate only ever pulls that earlier, never later, so
 * a line can never reach into its neighbour.
 */
export function sungEnd(
  startSec: number,
  boundarySec: number,
  units: number,
  rate: number,
): number {
  const estimated = startSec + Math.max(1, units) * rate * SLACK;
  const floor = Math.min(boundarySec, startSec + MIN_LINE_SEC);
  return Math.max(floor, Math.min(boundarySec, estimated));
}

/**
 * Place each word of a line between the times that are known.
 *
 * `anchors` runs parallel to the line's whitespace-separated words: a number
 * is a word someone timed by hand, `null` a word to be inferred. Anchors that
 * cannot be true — out of order, outside the line — are dropped rather than
 * repaired, because a tap in the wrong place is better ignored than allowed to
 * reorder the words around it.
 */
export function wordTimings(
  text: string,
  startSec: number,
  endSec: number,
  anchors: readonly (number | null | undefined)[] = [],
): TimedWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const weights = tokens.map((token) => Math.max(1, unitCount(token)));
  const span = Math.max(endSec, startSec);

  // Every point in the line whose time is not a guess, in order: the line's
  // own start, the anchors that survive, and the line's end as a closing post.
  const fixedAt: number[] = [0];
  const fixedTime: number[] = [firstStart(anchors[0], startSec, span)];

  for (let index = 1; index < tokens.length; index += 1) {
    const at = anchors[index];
    if (at === null || at === undefined || !Number.isFinite(at)) continue;
    const previous = fixedTime[fixedTime.length - 1]!;
    if (at <= previous || at >= span) continue;
    fixedAt.push(index);
    fixedTime.push(at);
  }
  fixedAt.push(tokens.length);
  fixedTime.push(span);

  const starts = new Array<number>(tokens.length + 1).fill(span);
  for (let segment = 0; segment + 1 < fixedAt.length; segment += 1) {
    const from = fixedAt[segment]!;
    const to = fixedAt[segment + 1]!;
    const openedAt = fixedTime[segment]!;
    const closedAt = fixedTime[segment + 1]!;

    let total = 0;
    for (let index = from; index < to; index += 1) total += weights[index]!;

    let carried = 0;
    for (let index = from; index < to; index += 1) {
      starts[index] = openedAt + ((closedAt - openedAt) * carried) / (total || 1);
      carried += weights[index]!;
    }
    starts[to] = closedAt;
  }

  return tokens.map((token, index) => ({
    text: token,
    startSec: starts[index]!,
    endSec: starts[index + 1]!,
  }));
}

/**
 * The first word starts when the line does — unless it was tapped itself, in
 * which case that tap is the better number, having been made while listening
 * to this word rather than to the line as a whole.
 */
function firstStart(anchor: number | null | undefined, startSec: number, endSec: number): number {
  if (anchor === null || anchor === undefined || !Number.isFinite(anchor)) return startSec;
  return Math.min(Math.max(anchor, startSec), endSec);
}
