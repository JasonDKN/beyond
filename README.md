# Beyond

**Songs, written in sound.**

Beyond takes an audio file, finds the words in it, and writes each one in the
International Phonetic Alphabet — then lays the result across the waveform at
the moment it was sung.

It is built for the people who need to know not just *what* was sung but *how*:
singers learning repertoire in a language they do not speak, diction coaches,
linguists, translators, and anyone who has ever tried to work out what a lyric
actually says.

```
Beyond      the    edge   of    every    ordinary        word
bɪˈɑnd      ðə     ɛdʒ    ʌv    ˈɛvɚi    ˈɔɹdəˌnɛɹi      wɝd
```

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

> **If `npm install` fails on `onnxruntime-node`** — that package's postinstall
> downloads native binaries, which some networks block. Beyond only ever uses
> the *web* build of the runtime, so `npm install --ignore-scripts` is a
> complete fix rather than a workaround.

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
  the output-language menu goes live the moment one is registered.

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
