# Beyond

**Learn to sing a song in a language you don't speak.**

Beyond takes an audio file and the lyrics, and shows you — word by word, in
time with the music — how the words are actually pronounced, which is very
often not how they are written.

```
좋아요       우리      노래          ← what's written
조아요                              ← what's actually said
tɕoajo      uɾi      noɾe          ← IPA
jo-ah-yo    oo-ree   no-reh        ← read-along
```

That second line is the whole point. Korean spelling preserves the shape of a
word even when the sounds change: 좋아요 keeps its ㅎ on paper although nobody
pronounces one. Almost every romanization on a lyrics site transliterates the
*spelling* — which is exactly why people who learn from them sound wrong. They
are reading a form of the word that is never spoken.

Beyond shows you both, and names the rule that separates them.

---

## Why not just use Spotify?

You can't. Playback through Spotify's Web Playback SDK goes over an encrypted
media path, so the decoded audio is never exposed to the page — and capturing
it anyway would breach their terms. Spotify also
[restricted much of its Web API in November 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api):
apps registered after that date get no Audio Analysis, no Audio Features, and
no 30-second previews. Lyrics were never in the public API at all.

So Beyond works from a file you own. Which turns out to be the better design
anyway — see below.

## Why not just transcribe it?

Because you already know what the words are. They're printed in the sleeve.

Speech recognition is the wrong tool for learning a song you have the lyrics
to: it guesses at the one thing you already know, and on fast rap over a dense
mix it guesses badly. So the default path inverts it — **you paste the lyrics
and tap once per line** as the track plays. Three minutes of tapping produces
timings a forced aligner would not beat, correct by construction, with nothing
to second-guess.

Whisper is still one menu item away for when you genuinely don't know what was
sung.

Beyond neither fetches nor ships anyone's lyrics. You supply the words.

---

## Working on a song

1. **Drop in the audio.** A file you own — MP3, WAV, FLAC, M4A.
2. **Paste the lyrics** into the lyric sheet panel. One line per line; section
   markers like `[Verse 1]` are ignored.
3. **Tap the timing.** Play the track and press **T** (or click Tap) as each
   line begins. Tapping slightly late is normal, so 120 ms is subtracted
   automatically. The `⟲` button on any line re-times just that one.
4. **Build the score.** Everything below appears: staff, syllable grid,
   layered readings, word inspector.
5. **Practise.** `[` and `]` set an A–B loop around a phrase; `\` clears it.
   Drop the speed to 0.5× — the pitch stays put, so it's still in key.

Timings are saved per file, so closing the tab doesn't lose your work.

### The four layers

Each word is stacked, and each layer can be switched off as you outgrow it:

| Layer | What it is |
| --- | --- |
| **Written** | The lyric exactly as printed |
| **Spoken** | The same word rewritten as it's pronounced — *only shown when it differs* |
| **IPA** | Precise phonetic transcription |
| **Read-along** | Plain-alphabet reading you can sing from tonight |

Wherever the Spoken layer appears, a sound rule fired — those are the
teachable moments, and the status bar counts them for you.

### The syllable grid

Korean is syllable-timed: every Hangul block gets roughly equal duration, and
one block is one rhythmic slot. English is stress-timed, so an English speaker
instinctively crushes the syllables between stresses — in Korean that instinct
is exactly wrong, and it's the main thing to unlearn.

The grid shows the current line as equal cells sweeping in time. It's the
difference between "this is too fast" and "there are eleven of them, evenly
spaced."

---

## The idea behind the interface

The IPA vowel chart is already a picture. Height — how close the tongue sits to
the roof of the mouth — runs down one axis; backness runs along the other. A
musical staff is also a picture, with pitch on the vertical.

Beyond overlays them. Five staff lines are ruled across the waveform, and every
word is placed on them as a notehead whose height is **the height of its
stressed vowel**: `[i]` in *see* rides at the top of the staff, `[ɑ]` in
*father* sits at the bottom. The curve traced through those noteheads is not a
melody — it is the shape the singer's mouth made, drawn in the same space as
the sound it produced.

The same axis drives the colour. Front vowels take the mint end of the palette,
back vowels the violet end, so a vowel keeps its colour from the staff to the
inspector to the syllable breakdown. Anything the app had to guess is amber.

---

## What it does

- **Transcribes** an uploaded file to timed words, using Whisper running
  locally in your browser. No key, no upload, works offline after the first run.
- **Converts each word to IPA** — dictionary first, letter-to-sound rules
  second, and it tells you which of the two it used.
- **Syllabifies** with the Maximum Onset Principle and marks primary and
  secondary stress in the correct position.
- **Adjusts for singing**: sustained vowels are lengthened, and reduced vowels
  held on a long note open back up, the way a diction coach would mark them.
- **Follows the audio**, illuminating each word on the staff and in the score as
  it is sung. Slow playback down without changing the key.
- **Exports** to interlinear text, SRT/VTT subtitles, CSV, or the full JSON
  score.

---

## Getting started

```bash
npm install
npm run dev
```

Then open the URL it prints and drop in an audio file.

The first transcription downloads the Whisper model (~80 MB for `whisper-base`)
from the Hugging Face CDN; the browser caches it afterwards. If you want to see
the interface working immediately, choose **Demo transcript (no model)** in the
Engine menu — it fabricates a timed lyric over whatever file you loaded.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build |
| `npm test` | Unit tests (phonetics, timing, export) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` |

Requires Node 20.19+. WebGPU is used when the browser has it and WASM otherwise;
the WASM path works everywhere but is several times slower.

---

## Deploying

Beyond is entirely client-side — audio is decoded in the browser and never
uploaded — so any static host will serve it.

**GitHub Pages** is wired up in `.github/workflows/deploy.yml`. Every push to
`main` typechecks, tests, builds and publishes; a failing test stops the deploy
rather than replacing a working site with a broken one. Enable it once, under
**Settings → Pages → Source → GitHub Actions**, and the site appears at
`https://<user>.github.io/beyond/`.

The subpath is why `vite.config.ts` reads `BEYOND_BASE`. A project site is
served from `/beyond/`, not `/`, and without the prefix every asset 404s and
the page loads blank. The workflow sets it; nothing else needs to know.

For **Netlify or Vercel**, point them at the repo with build command
`npm run build` and publish directory `dist`. Leave `BEYOND_BASE` unset — both
serve from the root, and the default is `/`.

One caveat on Pages: it cannot set the `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers that multithreaded WebAssembly needs, so
the in-browser Whisper option runs single-threaded and slowly there. The lyric
sheet path — the one this app is built around — is unaffected. Netlify and
Vercel can both set those headers if you want the Whisper option to be fast on
a deployed site.

---

## How it is put together

```
src/
  audio/          decode → mono 16 kHz → peak envelope → transport
  transcription/  provider interface + Whisper (local), OpenAI, Deepgram, demo
  phonetics/      ARPAbet↔IPA, G2P engines, syllabifier, sung-vowel treatment
  translation/    provider interface for the second language axis (no engine yet)
  export/         interlinear, SRT, VTT, CSV, JSON
  ui/             staff canvas, score, inspector, transport, controls
  core/           types, store, pipeline
```

The pipeline is linear and each stage owns exactly one type:

```
File → AudioSource → Transcript → PhoneticScore → the staff
```

Every stage is language-tagged, and the two language axes are deliberately
separate. **Input language** decides how a line is pronounced. **Output
language** decides what it is rendered alongside. Someone learning a Portuguese
fado wants the IPA of the Portuguese and the meaning in English, side by side —
those are different questions, so they are different menus.

### The Korean engine

`src/phonetics/g2p/ko/` is the heart of the app, and needs no dictionary at
all. Hangul is algorithmically composed — every syllable block is
`0xAC00 + (initial × 588) + (medial × 28) + final` — so decomposing 학 into
ㅎ + ㅏ + ㄱ is arithmetic. What the spelling hides is the sound changes, and
those are rules:

| File | What it does |
| --- | --- |
| `jamo.ts` | Decompose and recompose syllable blocks |
| `phonology.ts` | The standard pronunciation rules (표준 발음법), in order |
| `ipa.ts` | Jamo → IPA, with voicing, palatalization, unreleased finals |
| `respell.ts` | The plain-alphabet read-along layer |

The rules, and why order matters:

| Rule | Example | What happens |
| --- | --- | --- |
| 연음 liaison | 옷이 → 오시 | a final consonant slides into the next syllable |
| ㅎ 탈락 | 좋아요 → 조아요 | ㅎ goes silent before a vowel |
| 격음화 | 놓고 → 노코 | ㅎ merges with a stop and aspirates it |
| 끝소리 규칙 | 꽃 → 꼳 | a syllable can only end in one of seven sounds |
| 자음군 단순화 | 값 → 갑 | two-consonant finals lose one |
| 구개음화 | 같이 → 가치 | ㄷ/ㅌ before 이 becomes ㅈ/ㅊ |
| 유음화 | 신라 → 실라 | ㄴ and ㄹ meeting become ㄹㄹ |
| 비음화 | 국민 → 궁민 | a stop before a nasal becomes a nasal |
| 경음화 | 학교 → 학꾜 | a lax consonant tenses after a stop |

Liaison has to run before neutralization or 옷이 comes out [오디]; palatalization
has to see the ㅌ that liaison just moved. Each rule is tested against the
standard example that isolates it, in `tests/korean.test.ts`.

Korean pronunciations are reported as **derived**, not *guessed* — the same
standing as an English dictionary hit. English letter-to-sound rules are a
fallback for words the dictionary lacks; Korean rules are the actual grammar of
the language's pronunciation.

### Adding a language

Write one file and register it. Nothing upstream or downstream changes.

```ts
// src/phonetics/g2p/fr/index.ts
import type { G2PEngine, Pronunciation } from '../engine';

class FrenchG2P implements G2PEngine {
  readonly id = 'fr-rules';
  readonly label = 'French — orthographic rules';
  readonly languages = ['fr'] as const;
  readonly quality = 'rules' as const;

  async load(): Promise<void> {}

  pronounce(word: string): Pronunciation {
    return { phones: /* … */ [], source: 'rules', confidence: 0.85 };
  }
}

export const frenchG2P: G2PEngine = new FrenchG2P();
```

```ts
// src/phonetics/registry.ts
registerG2P(frenchG2P);
```

That is the entire contract. The language menu reads the registry, so the new
language appears on its own, and the control bar starts reporting phonetic
coverage for it. `src/phonetics/g2p/es/index.ts` is a complete worked example in
about 200 lines — Spanish orthography is regular enough to need no dictionary at
all.

For a language where a dictionary is unavoidable (English, French, Japanese),
`src/phonetics/g2p/en/` shows the pattern: lazy-load the lexicon in `load()` so
it lands in its own bundle chunk, and fall back to rules with reduced confidence
for anything the dictionary has never heard of.

### Adding a transcription engine

Same shape. Implement `TranscriptionProvider`, call `registerProvider`, and it
appears in the Engine menu. `src/transcription/providers/demo.ts` is the
reference implementation at about forty lines.

Cloud adapters read their keys from `.env` (copy `.env.example`). Anything
prefixed `VITE_` is embedded in the client bundle, so for anything
public-facing, point `VITE_OPENAI_BASE_URL` at your own server and keep the key
there — the adapter needs no changes.

---

### Meaning

`src/korean/morphology.ts` breaks a word into its stem plus the grammar stacked
on it — 먹었어요 → 먹 + 었 (past) + 어요 (polite casual). Korean is
agglutinative, so this is where the reusable learning is: a line translation
teaches you that line, but recognising -었- teaches you every past tense you
will ever hear.

It's a suffix stripper covering the closed-class grammar — particles and verb
endings — which is the part that repeats endlessly. Open-class stems are left
for you to gloss yourself, and the `Glossary` class stores those in
localStorage and exports TSV straight into Anki. Writing your own gloss for a
word you just heard in a song you like beats reading someone else's.

---

## Honest limitations

- **Phone timings are estimated, not aligned.** A word's duration is
  distributed across its phones by weight — vowels carry the note, consonants
  are transient. That is enough to illuminate the right glyph at roughly the
  right moment; it is not forced alignment, and it will not survive being used
  as ground truth.
- **The rules engine is a fallback, not a phonemizer.** Words outside the
  dictionary get a guess, marked amber with a dotted underline and a reduced
  confidence score. Believe the badge.
- **Whisper hears music imperfectly.** A vocal buried under a dense mix will
  come back garbled. An isolated vocal stem transcribes dramatically better than
  a full master.
- **Stress in guessed words is a heuristic** — first syllable for short words,
  antepenult for long ones. Correct often, not always.
- **English is General American**, because that is what CMUdict describes.
  Non-rhotic and other varieties need their own lexicon.
- **No translation engine ships.** The interface and the provider seam exist;
  the output-language menu goes live the moment one is registered. Until then,
  meaning comes from the morpheme breakdown and your own glossary.
- **Korean compound-boundary effects are not handled.** ㄴ-insertion and some
  tensification depend on knowing where one word inside a compound ends, which
  needs morphology the engine does not have. This is the narrow band where a
  Korean reading can be wrong, and it is why confidence is 0.92 rather than 1.
- **Morpheme segmentation is a heuristic, not a parser.** 는 is both a topic
  particle and a verb modifier ending, and telling them apart needs to know
  whether the stem is a noun or a verb. The commoner reading is shown and the
  other is named in the note. Where a split would be a coin-flip — 바다 as
  "sea" or as a verb 바- plus -다 — the word is left whole, because inventing
  grammar that is not there teaches something false.

---

## Attribution and licence

Pronunciations come from the [CMU Pronouncing
Dictionary](https://github.com/cmusphinx/cmudict) (BSD-2-Clause) via the
`cmu-pronouncing-dictionary` package. Speech recognition uses OpenAI's Whisper
models through
[transformers.js](https://github.com/huggingface/transformers.js). Typefaces are
Fraunces, Inter, and Gentium Plus (SIL Open Font License) — Gentium carries the
full IPA range, including the length marks and r-coloured vowels most interface
fonts quietly substitute.

MIT.
