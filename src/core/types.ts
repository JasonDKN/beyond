/**
 * Beyond — shared domain model.
 *
 * The pipeline is deliberately linear and each stage owns one type:
 *
 *   File → AudioSource → TranscriptSegment[] → PhoneticLine[] → rendered staff
 *
 * Every stage is language-tagged so that swapping the input language (what was
 * sung) or the output language (what we render alongside it) never requires
 * touching the stages either side of it.
 */

/** BCP-47 language tag, e.g. `en`, `en-GB`, `es-419`, `ja`. */
export type LanguageTag = string;

/** Notation a phonetic line can be rendered in. IPA is the default. */
export type Notation = 'ipa' | 'ipa-broad' | 'arpabet' | 'romaji' | 'pinyin';

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface AudioSource {
  /** Original file name, used for titles and export filenames. */
  readonly name: string;
  readonly durationSec: number;
  readonly sampleRate: number;
  readonly channels: number;
  /** Decoded PCM, kept so providers can resample without re-reading the file. */
  readonly buffer: AudioBuffer;
  /** Object URL backing the <audio> element used for playback. */
  readonly objectUrl: string;
}

/** Pre-computed min/max envelope for one zoom level of the waveform. */
export interface PeakEnvelope {
  readonly samplesPerPeak: number;
  readonly length: number;
  /** Interleaved [min, max] pairs in the range [-1, 1]. */
  readonly peaks: Float32Array;
  /** Per-bucket RMS, used to modulate glow intensity on the staff. */
  readonly rms: Float32Array;
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export interface TranscriptWord {
  readonly text: string;
  readonly startSec: number;
  readonly endSec: number;
  /** 0–1 model confidence, when the provider reports one. */
  readonly confidence?: number;
}

export interface TranscriptSegment {
  readonly id: string;
  readonly text: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly words: readonly TranscriptWord[];
  /** A translation of this line, when the source supplied one. */
  readonly translation?: string;
}

export interface Transcript {
  readonly language: LanguageTag;
  /** True when the language was detected rather than declared by the user. */
  readonly languageDetected: boolean;
  readonly segments: readonly TranscriptSegment[];
  readonly providerId: string;
  readonly modelId: string;
}

// ---------------------------------------------------------------------------
// Phonetics
// ---------------------------------------------------------------------------

/** Where a word's pronunciation came from — surfaced in the UI as a badge. */
export type PronunciationSource =
  | 'lexicon' // exact dictionary hit
  | 'lexicon-inflected' // dictionary hit after stripping a regular suffix
  | 'derived' // systematically derived from a regular orthography
  | 'rules' // grapheme-to-phoneme guess for an unknown word
  | 'user' // hand-corrected in the inspector
  | 'passthrough'; // no engine for this language yet

export interface Phone {
  /** IPA symbol for a single segment, e.g. `tʃ`, `ɑ`, `ɹ`. */
  readonly ipa: string;
  /** Engine-native label (ARPAbet for English), kept for debugging and export. */
  readonly native?: string;
  readonly isVowel: boolean;
  /** 0 = unstressed, 1 = primary, 2 = secondary. */
  readonly stress?: 0 | 1 | 2;
  /** Seconds, only present once phones have been aligned to the audio. */
  readonly startSec?: number;
  readonly endSec?: number;
}

export interface Syllable {
  readonly onset: readonly Phone[];
  readonly nucleus: readonly Phone[];
  readonly coda: readonly Phone[];
  readonly stress: 0 | 1 | 2;
}

/** One sound rule that fired while deriving a pronunciation. */
export interface PronunciationNote {
  /** Index of the syllable it applied to. */
  readonly at: number;
  /** Machine-readable rule id, e.g. `liaison`, `tensification`. */
  readonly rule: string;
  /** The rule's name in the language's own terms, e.g. `연음`. */
  readonly label: string;
  readonly explanation: string;
}

export interface PhoneticWord {
  readonly text: string;
  /** Lowercased, punctuation-stripped form actually sent to the G2P engine. */
  readonly normalized: string;
  readonly ipa: string;
  readonly phones: readonly Phone[];
  readonly syllables: readonly Syllable[];
  readonly source: PronunciationSource;
  /** 0–1 — how much to trust this transcription. Drives the UI's dotted underline. */
  readonly confidence: number;
  readonly startSec: number;
  readonly endSec: number;
  /** Alternative pronunciations from the lexicon, offered in the inspector. */
  readonly variants?: readonly string[];

  /** Plain-alphabet reading for learners who do not read IPA yet. */
  readonly respelling?: string;
  /** The word in its own script as actually said, when that differs from the spelling. */
  readonly pronouncedForm?: string;
  /** True when the spelling and the spoken form diverge — the teachable moment. */
  readonly changed?: boolean;
  /** Sound rules that fired, for the inspector to explain. */
  readonly notes?: readonly PronunciationNote[];
  /** Morphological breakdown, for agglutinative languages. */
  readonly morphemes?: readonly Morpheme[];
}

/** One piece of a word, with what it contributes to the meaning. */
export interface Morpheme {
  readonly text: string;
  /** `stem`, `particle`, `ending`, `suffix`. */
  readonly kind: 'stem' | 'particle' | 'ending' | 'suffix';
  /** Short gloss: "topic marker", "past tense", "want to". */
  readonly gloss: string;
  /** Longer note shown on demand. */
  readonly detail?: string;
}

export interface PhoneticLine {
  readonly id: string;
  readonly text: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly words: readonly PhoneticWord[];
  /** Optional translation of the line into the chosen output language. */
  readonly translation?: string;
}

export interface PhoneticScore {
  readonly title: string;
  readonly inputLanguage: LanguageTag;
  readonly outputLanguage: LanguageTag | null;
  readonly notation: Notation;
  readonly lines: readonly PhoneticLine[];
  readonly durationSec: number;
  readonly meta: {
    readonly providerId: string;
    readonly modelId: string;
    readonly g2pEngineId: string;
    readonly generatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Progress reporting — shared by every long-running stage
// ---------------------------------------------------------------------------

export type StageId = 'decode' | 'analyze' | 'transcribe' | 'phonemize' | 'translate';

export interface Progress {
  readonly stage: StageId;
  /** 0–1, or null when the stage cannot report a ratio. */
  readonly ratio: number | null;
  readonly message: string;
}

export type ProgressHandler = (progress: Progress) => void;
