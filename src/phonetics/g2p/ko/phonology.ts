import { CLUSTER_FINALS, type Jamo } from './jamo';

/**
 * Korean pronunciation rules — 표준 발음법, the standard pronunciation rules.
 *
 * This file is the reason Beyond is worth pointing at Korean at all.
 *
 * Hangul spelling is morphophonemic: it preserves the shape of a morpheme even
 * when the sounds around it change that shape. So 좋아요 keeps its ㅎ on paper
 * although nobody pronounces one, and 신라 keeps its ㄴ although everyone says
 * an ㄹ. Almost every romanization a learner finds online transliterates the
 * *spelling*, which is precisely why singers taught from those romanizations
 * sound wrong — they are reading a form of the word that is never spoken.
 *
 * These rules convert written Hangul into spoken Hangul. Everything downstream
 * — IPA, respelling, the staff — reads the output of this file, never the raw
 * spelling.
 *
 * Rule order is not arbitrary. Liaison has to run before neutralization or
 * 옷이 becomes [오디] instead of [오시]; palatalization has to see the ㅌ that
 * liaison just moved. The order below follows the standard analysis.
 */

export interface PhonologyOptions {
  /** Apply the rules at all. Off gives you a letter-by-letter reading. */
  readonly enabled: boolean;
  /**
   * Tensification after an obstruent (학교 → 학꾜). Always correct, but a
   * beginner may want it off while learning to read.
   */
  readonly tensification: boolean;
  /** ㄷ/ㅌ + 이 → ㅈ/ㅊ (같이 → 가치). */
  readonly palatalization: boolean;
}

export const DEFAULT_PHONOLOGY: PhonologyOptions = {
  enabled: true,
  tensification: true,
  palatalization: true,
};

/** The seven consonants a Korean syllable may actually end with. */
const NEUTRALIZATION: Readonly<Record<string, string>> = {
  ㄲ: 'ㄱ',
  ㅋ: 'ㄱ',
  ㅅ: 'ㄷ',
  ㅆ: 'ㄷ',
  ㅈ: 'ㄷ',
  ㅊ: 'ㄷ',
  ㅌ: 'ㄷ',
  ㅎ: 'ㄷ',
  ㅍ: 'ㅂ',
};

/** Which single consonant a two-consonant final keeps when it cannot resyllabify. */
const CLUSTER_SURVIVOR: Readonly<Record<string, string>> = {
  ㄳ: 'ㄱ',
  ㄵ: 'ㄴ',
  ㄶ: 'ㄴ',
  ㄺ: 'ㄱ',
  ㄻ: 'ㅁ',
  ㄼ: 'ㄹ',
  ㄽ: 'ㄹ',
  ㄾ: 'ㄹ',
  ㄿ: 'ㅂ',
  ㅀ: 'ㄹ',
  ㅄ: 'ㅂ',
};

const TENSE: Readonly<Record<string, string>> = {
  ㄱ: 'ㄲ',
  ㄷ: 'ㄸ',
  ㅂ: 'ㅃ',
  ㅅ: 'ㅆ',
  ㅈ: 'ㅉ',
};

const ASPIRATED: Readonly<Record<string, string>> = {
  ㄱ: 'ㅋ',
  ㄷ: 'ㅌ',
  ㅂ: 'ㅍ',
  ㅈ: 'ㅊ',
};

/** Obstruent codas, which are the ones that trigger tensing and nasalizing. */
const OBSTRUENT_CODA = new Set(['ㄱ', 'ㄷ', 'ㅂ']);

const NASALIZED_CODA: Readonly<Record<string, string>> = {
  ㄱ: 'ㅇ',
  ㄷ: 'ㄴ',
  ㅂ: 'ㅁ',
};

const NASALS = new Set(['ㄴ', 'ㅁ']);

/** A record of one rule firing, so the UI can explain itself. */
export interface RuleApplication {
  /** Index of the syllable that changed. */
  readonly at: number;
  readonly rule: string;
  readonly korean: string;
  readonly note: string;
}

export interface PhonologyResult {
  readonly syllables: Jamo[];
  readonly applied: RuleApplication[];
}

/**
 * Run the rules over a sequence of decomposed syllables.
 *
 * Operates on a whole word (or phrase) at once, because every interesting rule
 * lives at a syllable boundary and a single syllable in isolation is never
 * enough to know what happens to it.
 */
export function applyPhonology(
  input: readonly Jamo[],
  options: PhonologyOptions = DEFAULT_PHONOLOGY,
): PhonologyResult {
  const s: Jamo[] = input.map((jamo) => ({ ...jamo }));
  const applied: RuleApplication[] = [];

  const note = (at: number, rule: string, korean: string, text: string): void => {
    applied.push({ at, rule, korean, note: text });
  };

  if (!options.enabled) return { syllables: s, applied };

  // -------------------------------------------------------------------------
  // 1. 연음 — liaison. A final consonant slides into a following empty onset.
  //    This is the single most common reason spelling and sound diverge, and
  //    it must run first: it feeds palatalization and it pre-empts the coda
  //    neutralization that would otherwise destroy the consonant's identity.
  // -------------------------------------------------------------------------
  for (let i = 0; i < s.length - 1; i += 1) {
    const current = s[i]!;
    const next = s[i + 1]!;
    if (!current.coda || next.onset !== 'ㅇ') continue;

    const cluster = CLUSTER_FINALS[current.coda];
    if (cluster) {
      // Only the second consonant moves; the first stays behind. 앉아 → 안자
      const [stays, moves] = cluster;
      current.coda = stays;
      next.onset = moves;
      note(i, 'liaison', '연음', `${current.coda} stays, ${moves} moves to the next syllable`);
    } else if (current.coda === 'ㅇ') {
      // ㅇ is [ŋ] here and does not move — 강아지 stays 강아지.
      continue;
    } else if (current.coda === 'ㅎ') {
      // ㅎ before a vowel simply disappears. 좋아 → 조아
      current.coda = '';
      note(i, 'h-deletion', 'ㅎ 탈락', 'ㅎ is silent before a vowel');
    } else {
      next.onset = current.coda;
      current.coda = '';
      note(i, 'liaison', '연음', 'the final consonant moves into the next syllable');
    }
  }

  // -------------------------------------------------------------------------
  // 2. 구개음화 — palatalization. ㄷ/ㅌ meeting 이 becomes ㅈ/ㅊ.
  //    Runs right after liaison, because liaison is what puts the ㄷ/ㅌ in
  //    onset position in front of the 이 in the first place. 같이 → 가치
  // -------------------------------------------------------------------------
  if (options.palatalization) {
    for (let i = 1; i < s.length; i += 1) {
      const syllable = s[i]!;
      if (syllable.nucleus !== 'ㅣ') continue;
      if (syllable.onset === 'ㄷ') {
        syllable.onset = 'ㅈ';
        note(i, 'palatalization', '구개음화', 'ㄷ before 이 becomes ㅈ');
      } else if (syllable.onset === 'ㅌ') {
        syllable.onset = 'ㅊ';
        note(i, 'palatalization', '구개음화', 'ㅌ before 이 becomes ㅊ');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. 격음화 — aspiration around ㅎ, in both directions.
  //    좋고 → 조코 (ㅎ + ㄱ), 국화 → 구콰 (ㄱ + ㅎ), 놓는 → 논는 (ㅎ + ㄴ).
  // -------------------------------------------------------------------------
  for (let i = 0; i < s.length - 1; i += 1) {
    const current = s[i]!;
    const next = s[i + 1]!;

    // ㅎ-final meeting a lax obstruent: the obstruent aspirates, ㅎ is consumed.
    if ((current.coda === 'ㅎ' || current.coda === 'ㄶ' || current.coda === 'ㅀ') && ASPIRATED[next.onset]) {
      current.coda = current.coda === 'ㄶ' ? 'ㄴ' : current.coda === 'ㅀ' ? 'ㄹ' : '';
      next.onset = ASPIRATED[next.onset]!;
      note(i, 'aspiration', '격음화', `ㅎ merges into the next consonant, aspirating it`);
      continue;
    }

    // ㅎ-final meeting a nasal: ㅎ becomes ㄴ. 놓는 → 논는
    if (current.coda === 'ㅎ' && NASALS.has(next.onset)) {
      current.coda = 'ㄴ';
      note(i, 'h-nasalization', 'ㅎ 비음화', 'ㅎ becomes ㄴ before a nasal');
      continue;
    }

    // Obstruent final meeting ㅎ: the obstruent aspirates and moves. 국화 → 구콰
    if (next.onset === 'ㅎ' && ASPIRATED[current.coda]) {
      next.onset = ASPIRATED[current.coda]!;
      current.coda = '';
      note(i, 'aspiration', '격음화', 'the final consonant merges with ㅎ and aspirates');
    }
  }

  // -------------------------------------------------------------------------
  // 4. 자음군 단순화 — a surviving two-consonant final loses one consonant.
  // -------------------------------------------------------------------------
  //    A dropped consonant leaves a trace: it is silent, but it still tenses
  //    whatever follows. 앉다 is [안따], not [안다] — the ㅈ of ㄵ is gone from
  //    the surface yet still hardens the next ㄷ. Recording that here is what
  //    lets tensification fire correctly further down without needing to know
  //    which words are verbs.
  const hiddenConsonant = new Set<number>();
  for (let i = 0; i < s.length; i += 1) {
    const syllable = s[i]!;
    const survivor = CLUSTER_SURVIVOR[syllable.coda];
    if (!survivor) continue;
    note(i, 'cluster-reduction', '자음군 단순화', `the ${syllable.coda} cluster reduces to ${survivor}`);
    syllable.coda = survivor;
    hiddenConsonant.add(i);
  }

  // -------------------------------------------------------------------------
  // 5. 음절의 끝소리 규칙 — coda neutralization.
  //    A Korean syllable can only end in one of seven sounds, and the final
  //    consonant is unreleased. 꽃 is written with ㅊ and said with ㄷ.
  // -------------------------------------------------------------------------
  for (let i = 0; i < s.length; i += 1) {
    const syllable = s[i]!;
    const neutralized = NEUTRALIZATION[syllable.coda];
    if (!neutralized) continue;
    note(
      i,
      'neutralization',
      '끝소리 규칙',
      `${syllable.coda} at the end of a syllable is pronounced ${neutralized}`,
    );
    syllable.coda = neutralized;
  }

  // -------------------------------------------------------------------------
  // 6. ㄹ interactions.
  //    유음화: ㄴ+ㄹ or ㄹ+ㄴ both become ㄹㄹ. 신라 → 실라, 설날 → 설랄
  //    ㄹ → ㄴ after a nasal or an obstruent. 종로 → 종노, 독립 → 독닙
  // -------------------------------------------------------------------------
  for (let i = 0; i < s.length - 1; i += 1) {
    const current = s[i]!;
    const next = s[i + 1]!;

    if (current.coda === 'ㄴ' && next.onset === 'ㄹ') {
      current.coda = 'ㄹ';
      note(i, 'lateralization', '유음화', 'ㄴ before ㄹ becomes ㄹ');
    } else if (current.coda === 'ㄹ' && next.onset === 'ㄴ') {
      next.onset = 'ㄹ';
      note(i + 1, 'lateralization', '유음화', 'ㄴ after ㄹ becomes ㄹ');
    } else if (next.onset === 'ㄹ' && (current.coda === 'ㅁ' || current.coda === 'ㅇ')) {
      next.onset = 'ㄴ';
      note(i + 1, 'l-nasalization', 'ㄹ 비음화', 'ㄹ after a nasal becomes ㄴ');
    } else if (next.onset === 'ㄹ' && OBSTRUENT_CODA.has(current.coda)) {
      // 독립: ㄹ becomes ㄴ first, and the new ㄴ then nasalizes the ㄱ below.
      next.onset = 'ㄴ';
      note(i + 1, 'l-nasalization', 'ㄹ 비음화', 'ㄹ after a stop becomes ㄴ');
    }
  }

  // -------------------------------------------------------------------------
  // 7. 비음화 — nasalization. A stop before a nasal becomes the matching nasal.
  //    국민 → 궁민, 받는 → 반는, 밥물 → 밤물. Runs after the ㄹ rules so that
  //    the ㄴ they just created counts as a trigger (독립 → 독닙 → 동닙).
  // -------------------------------------------------------------------------
  for (let i = 0; i < s.length - 1; i += 1) {
    const current = s[i]!;
    const next = s[i + 1]!;
    if (!OBSTRUENT_CODA.has(current.coda) || !NASALS.has(next.onset)) continue;
    const nasalized = NASALIZED_CODA[current.coda]!;
    note(i, 'nasalization', '비음화', `${current.coda} before a nasal becomes ${nasalized}`);
    current.coda = nasalized;
  }

  // -------------------------------------------------------------------------
  // 8. 경음화 — tensification. A lax consonant after an unreleased stop comes
  //    out tense. 학교 → 학꾜. Last, because it needs the final coda inventory.
  // -------------------------------------------------------------------------
  if (options.tensification) {
    for (let i = 0; i < s.length - 1; i += 1) {
      const current = s[i]!;
      const next = s[i + 1]!;
      // Either a surface obstruent, or a nasal that swallowed one.
      if (!OBSTRUENT_CODA.has(current.coda) && !hiddenConsonant.has(i)) continue;
      const lax = next.onset;
      const tensed = TENSE[lax];
      if (!tensed) continue;
      next.onset = tensed;
      note(i + 1, 'tensification', '경음화', `${lax} becomes tense ${tensed} after a stop`);
    }
  }

  return { syllables: s, applied };
}
