import { decodeFile, releaseSource } from '@/audio/decoder';
import { computePeaks, detectOnsets, mixdown } from '@/audio/peaks';
import { phonemize } from '@/phonetics/phonemize';
import { getProvider } from '@/transcription';
import { translateScore } from '@/translation/provider';
import type { Store } from './store';
import type { Progress } from './types';

/** Envelope resolution. ~4000 buckets is more than any display needs, and it
 * lets us zoom in without recomputing. */
const PEAK_BUCKETS = 4000;

/**
 * The whole journey, in one function: file in, phonetic score out.
 *
 * Each stage reports progress into the store rather than returning it, so the
 * UI can narrate a slow local Whisper run without the pipeline knowing the UI
 * exists.
 */
export async function runPipeline(store: Store, file: File, signal?: AbortSignal): Promise<void> {
  const report = (progress: Progress): void => store.patch({ progress });

  try {
    releaseSource(store.state.audio);
    store.patch({
      status: 'working',
      error: null,
      notice: null,
      score: null,
      envelope: null,
      onsets: [],
      selected: null,
      currentTime: 0,
    });

    // 1 — Decode
    const audio = await decodeFile(file, report);
    store.patch({ audio });

    // 2 — Envelope + onsets, so the staff can be drawn before the model finishes
    report({ stage: 'analyze', ratio: null, message: 'Reading the waveform…' });
    const envelope = computePeaks(mixdown(audio.buffer), PEAK_BUCKETS);
    const onsets = detectOnsets(envelope, audio.sampleRate);
    store.patch({ envelope, onsets });

    // 3 — Transcribe
    const provider = getProvider(store.state.providerId);
    if (!provider) throw new Error(`Unknown transcription provider: ${store.state.providerId}`);

    // Not being ready is not the same as being broken. Loading a song before
    // pasting its lyrics is simply step one of two, so say what to do next
    // rather than reporting a failure.
    const availability = await provider.available();
    if (!availability.ok) {
      store.patch({
        status: 'idle',
        progress: null,
        notice: availability.reason ?? `${provider.label} is not ready yet.`,
      });
      return;
    }

    const transcript = await provider.transcribe({
      audio,
      language: store.state.inputLanguage,
      onProgress: report,
      ...(signal ? { signal } : {}),
    });

    // 4 — Phonemize
    let score = await phonemize(transcript, {
      notation: store.state.notation,
      syllableBreaks: store.state.syllableBreaks,
      stressMarks: store.state.stressMarks,
      singing: store.state.singing,
      onProgress: report,
      outputLanguage: store.state.outputLanguage,
    });
    score = { ...score, title: audio.name.replace(/\.[^.]+$/, '') };

    // 5 — Translate, if an output language is chosen and an engine is registered
    if (store.state.outputLanguage) {
      report({ stage: 'translate', ratio: null, message: 'Translating…' });
      score = await translateScore(score, store.state.outputLanguage);
    }

    store.patch({ status: 'ready', score, progress: null });
  } catch (error) {
    store.patch({
      status: 'error',
      progress: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
