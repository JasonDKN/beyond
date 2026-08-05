import { toMono16k } from '@/audio/decoder';
import { encodeWav } from '@/audio/wav';
import type { Transcript, TranscriptWord } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import {
  audioLabel,
  groupWordsIntoSegments,
  progressReporter,
  sanitizeWords,
  TranscriptionError,
} from '../provider';

/**
 * OpenAI transcription adapter.
 *
 * Faster and more accurate than the local model, at the cost of uploading the
 * audio and holding a key. `VITE_OPENAI_BASE_URL` exists so you can point this
 * at your own server: put the key there, keep it out of the bundle, and this
 * adapter needs no changes at all.
 */

interface VerboseTranscription {
  readonly text: string;
  readonly language?: string;
  readonly words?: readonly { word: string; start: number; end: number }[];
  readonly segments?: readonly { text: string; start: number; end: number }[];
}

class OpenAIProvider implements TranscriptionProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI Whisper (cloud)';
  readonly description =
    'Sends the audio to OpenAI for transcription. Needs an API key, or a proxy that holds one.';
  readonly requiresApiKey = true;
  readonly isLocal = false;

  readonly #model = 'whisper-1';

  async available(): Promise<{ ok: boolean; reason?: string }> {
    return this.#key()
      ? { ok: true }
      : { ok: false, reason: 'Set VITE_OPENAI_API_KEY in .env, or point VITE_OPENAI_BASE_URL at a proxy.' };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    const key = this.#key();
    if (!key) throw new TranscriptionError('No OpenAI API key configured.', this.id);

    report(null, 'Preparing audio…');
    const samples = await toMono16k(request.audio.buffer);
    const wav = encodeWav(samples, 16_000);

    const form = new FormData();
    form.append('file', wav, `${audioLabel(request.audio)}.wav`);
    form.append('model', this.#model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (request.language !== 'auto') form.append('language', request.language);

    report(null, 'Uploading…');

    const response = await fetch(`${this.#baseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok) {
      throw new TranscriptionError(
        `OpenAI returned ${response.status}: ${await response.text().catch(() => response.statusText)}`,
        this.id,
      );
    }

    const payload = (await response.json()) as VerboseTranscription;
    report(1, 'Transcript ready');

    const words: TranscriptWord[] = (payload.words ?? []).map((word) => ({
      text: word.word,
      startSec: word.start,
      endSec: word.end,
    }));

    if (words.length === 0) {
      throw new TranscriptionError('OpenAI returned no word timings for this audio.', this.id);
    }

    return {
      language: request.language === 'auto' ? (payload.language ?? 'en') : request.language,
      languageDetected: request.language === 'auto',
      segments: groupWordsIntoSegments(sanitizeWords(words, request.audio.durationSec)),
      providerId: this.id,
      modelId: this.#model,
    };
  }

  #key(): string {
    return import.meta.env['VITE_OPENAI_API_KEY'] ?? '';
  }

  #baseUrl(): string {
    return import.meta.env['VITE_OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  }
}

export const openAIProvider = new OpenAIProvider();
