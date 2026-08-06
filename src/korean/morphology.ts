import type { Morpheme } from '@/core/types';

/**
 * Korean morpheme segmentation, for learners.
 *
 * Korean is agglutinative: a word is a stem with a stack of suffixes glued to
 * it, each one carrying a piece of grammar. A line-level translation tells you
 * what a lyric means once. Seeing that 하고 싶었어 is
 *
 *     하-      do
 *     -고 싶-  want to
 *     -었-     past
 *     -어      casual ending
 *
 * teaches you a pattern you will then recognise in every other song you ever
 * listen to. That compounding is the whole reason to break words up rather
 * than just translate lines.
 *
 * This is a suffix stripper, not a full morphological analyser — it matches
 * the longest known ending at the right edge and repeats. A real analyser
 * (MeCab with mecab-ko-dic) needs a dictionary far too large to ship in a
 * browser tab. What this does get right is the closed-class grammar — the
 * particles and endings — which is the part that repeats endlessly and the
 * part a learner most needs named. The open-class stem is left for you to
 * gloss yourself, which is also how vocabulary actually sticks.
 */

interface Suffix {
  /** Surface forms, longest first within an entry. */
  readonly forms: readonly string[];
  readonly kind: Morpheme['kind'];
  readonly gloss: string;
  readonly detail?: string;
}

/**
 * Particles — they attach to nouns and mark the noun's role in the sentence.
 * Korean has no fixed word order, so these carry the load English gives to
 * position. Missing one is how a sentence stops making sense.
 */
const PARTICLES: readonly Suffix[] = [
  { forms: ['에서'], kind: 'particle', gloss: 'at / from', detail: 'location of an action, or origin' },
  { forms: ['에게', '한테'], kind: 'particle', gloss: 'to (a person)' },
  { forms: ['까지'], kind: 'particle', gloss: 'until / as far as' },
  { forms: ['부터'], kind: 'particle', gloss: 'from (starting at)' },
  { forms: ['처럼'], kind: 'particle', gloss: 'like / as' },
  { forms: ['보다'], kind: 'particle', gloss: 'than (comparison)' },
  { forms: ['으로', '로'], kind: 'particle', gloss: 'by / toward / using' },
  { forms: ['하고', '이랑', '랑', '와', '과'], kind: 'particle', gloss: 'and / with' },
  {
    forms: ['은', '는'],
    kind: 'particle',
    gloss: 'topic marker',
    detail:
      'marks what the sentence is about, often with a sense of contrast. The same syllable is also a verb modifier ending — after a noun it is the topic marker, after a verb stem it is the modifier',
  },
  { forms: ['이', '가'], kind: 'particle', gloss: 'subject marker' },
  { forms: ['을', '를'], kind: 'particle', gloss: 'object marker' },
  { forms: ['의'], kind: 'particle', gloss: "possessive 'of'" },
  { forms: ['에'], kind: 'particle', gloss: 'to / at / in' },
  { forms: ['도'], kind: 'particle', gloss: 'also / even' },
  { forms: ['만'], kind: 'particle', gloss: 'only' },
  { forms: ['야', '아'], kind: 'particle', gloss: 'calling someone by name' },
];

/**
 * Verb and adjective endings. Ordered longest-first overall so that `-었어요`
 * is matched before `-어요`, which would otherwise swallow the wrong slice.
 */
const ENDINGS: readonly Suffix[] = [
  { forms: ['습니다', 'ㅂ니다', '입니다'], kind: 'ending', gloss: 'formal polite', detail: 'the deferential style — news anchors, the army, addressing a crowd' },
  { forms: ['잖아요', '잖아'], kind: 'ending', gloss: "you know / as you're aware" },
  { forms: ['는데요', '는데', 'ㄴ데', '은데'], kind: 'ending', gloss: 'but / setting up context', detail: 'softens a statement or leaves it hanging for a reply' },
  { forms: ['니까', '으니까'], kind: 'ending', gloss: 'because' },
  { forms: ['지만'], kind: 'ending', gloss: 'but' },
  { forms: ['아서', '어서'], kind: 'ending', gloss: 'so / and then' },
  { forms: ['으면', '면'], kind: 'ending', gloss: 'if / when' },
  { forms: ['고 싶', '고싶'], kind: 'ending', gloss: 'want to' },
  { forms: ['겠'], kind: 'ending', gloss: 'will / intend to', detail: 'intention, or a guess about something' },
  { forms: ['었', '았', '였'], kind: 'ending', gloss: 'past tense' },
  { forms: ['구나', '군요'], kind: 'ending', gloss: 'realising something' },
  { forms: ['네요', '네'], kind: 'ending', gloss: 'noticing / mild surprise' },
  { forms: ['세요', '으세요'], kind: 'ending', gloss: 'polite request or honorific' },
  { forms: ['어요', '아요', '여요', '해요'], kind: 'ending', gloss: 'polite casual' },
  { forms: ['을까', 'ㄹ까'], kind: 'ending', gloss: 'shall we? / I wonder' },
  { forms: ['자'], kind: 'ending', gloss: "let's" },
  { forms: ['지'], kind: 'ending', gloss: 'right? / of course' },
  { forms: ['고'], kind: 'ending', gloss: 'and (linking verbs)' },
  { forms: ['는', '은', 'ㄴ'], kind: 'suffix', gloss: 'modifier ending', detail: 'turns a verb into something that describes a noun' },
  { forms: ['을', 'ㄹ'], kind: 'suffix', gloss: 'future modifier' },
  { forms: ['다'], kind: 'ending', gloss: 'dictionary form', detail: 'how a verb is listed in a dictionary' },
  { forms: ['요'], kind: 'ending', gloss: 'politeness marker' },
  { forms: ['어', '아'], kind: 'ending', gloss: 'casual ending' },
];

/**
 * Flattened and sorted so the longest surface form always wins.
 *
 * Particles come first so that ties resolve in their favour. 는 is both a
 * topic particle and a verb modifier ending, and telling them apart needs to
 * know whether the stem is a noun or a verb — which needs a dictionary. In
 * lyrics the topic reading is much the commoner of the two, so that is the
 * one shown, with the other named in its detail note.
 */
const ALL_SUFFIXES: readonly { form: string; suffix: Suffix }[] = [...PARTICLES, ...ENDINGS]
  .flatMap((suffix) => suffix.forms.map((form) => ({ form, suffix })))
  .sort((a, b) => b.form.length - a.form.length);

/**
 * Break a Korean word into a stem plus whatever grammar is stacked on it.
 *
 * Returns the stem first, then the suffixes in the order they appear, which is
 * inside-out: tense before politeness, exactly as Korean stacks them.
 */
export function segment(word: string): Morpheme[] {
  const cleaned = word.trim();
  if (!cleaned) return [];

  const suffixes: Morpheme[] = [];
  let remaining = cleaned;

  // Peel from the right. Cap the depth: three or four suffixes is a realistic
  // stack, and an unbounded loop on a strange token is not worth the risk.
  for (let depth = 0; depth < 5; depth += 1) {
    const match = ALL_SUFFIXES.find(({ form }) => {
      if (!remaining.endsWith(form)) return false;
      const stemLength = remaining.length - form.length;
      if (stemLength < 1) return false;

      // The guard that stops 바다 (sea) being read as a verb 바- plus the
      // dictionary ending -다. A one-syllable stem is perfectly normal *once
      // you are already inside a suffix stack* — 먹었어요 really is 먹 + 었 +
      // 어요 — but a two-syllable word being split for the first time is far
      // more often just a noun. When in doubt, leave the word whole: showing
      // a word unanalysed is a small loss, and inventing grammar that is not
      // there teaches something false.
      if (stemLength < 2 && suffixes.length === 0) return false;
      return true;
    });
    if (!match) break;

    remaining = remaining.slice(0, remaining.length - match.form.length);
    suffixes.unshift({
      text: match.form,
      kind: match.suffix.kind,
      gloss: match.suffix.gloss,
      ...(match.suffix.detail ? { detail: match.suffix.detail } : {}),
    });
  }

  if (suffixes.length === 0) {
    return [{ text: cleaned, kind: 'stem', gloss: '' }];
  }

  return [{ text: remaining, kind: 'stem', gloss: '' }, ...suffixes];
}

/**
 * A user-supplied glossary.
 *
 * Stems are left unglossed by the analyser, and rather than pretend otherwise
 * the app lets you fill them in as you go. Writing your own gloss for a word
 * you just heard in a song you like is a better way to learn it than reading
 * someone else's, and it means the app gets more useful the more you use it.
 */
export class Glossary {
  #entries = new Map<string, string>();
  readonly #storageKey: string;

  constructor(storageKey = 'beyond.glossary.ko') {
    this.#storageKey = storageKey;
    this.#load();
  }

  get(word: string): string | undefined {
    return this.#entries.get(word);
  }

  set(word: string, meaning: string): void {
    const trimmed = meaning.trim();
    if (trimmed) this.#entries.set(word, trimmed);
    else this.#entries.delete(word);
    this.#save();
  }

  get size(): number {
    return this.#entries.size;
  }

  entries(): [string, string][] {
    return [...this.#entries.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }

  /** Export as TSV, so it can go straight into Anki or a spreadsheet. */
  toTsv(): string {
    return this.entries()
      .map(([word, meaning]) => `${word}\t${meaning}`)
      .join('\n');
  }

  #load(): void {
    try {
      const raw = localStorage.getItem(this.#storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string') this.#entries.set(key, value);
        }
      }
    } catch {
      // A corrupt or unavailable store is not worth failing the app over.
    }
  }

  #save(): void {
    try {
      localStorage.setItem(this.#storageKey, JSON.stringify(Object.fromEntries(this.#entries)));
    } catch {
      // Private browsing, quota, etc. The glossary is a convenience, not state
      // the app depends on.
    }
  }
}
