import { toMono16k } from '@/audio/decoder';
import { encodeWav } from '@/audio/wav';
import type { Transcript, TranscriptWord } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import {
  groupWordsIntoSegments,
  progressReporter,
  sanitizeWords,
  TranscriptionError,
} from '../provider';

/**
 * Deepgram adapter.
 *
 * Included because Deepgram is unusually good at music: it reports per-word
 * confidence, which Beyond feeds straight into the dotted-underline treatment
 * on uncertain words, and its `smart_format` handles sung numerals sensibly.
 */

interface DeepgramWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly confidence?: number;
  readonly punctuated_word?: string;
}

interface DeepgramResponse {
  readonly results?: {
    readonly channels?: readonly {
      readonly detected_language?: string;
      readonly alternatives?: readonly {
        readonly transcript?: string;
        readonly words?: readonly DeepgramWord[];
      }[];
    }[];
  };
}

class DeepgramProvider implements TranscriptionProvider {
  readonly id = 'deepgram';
  readonly label = 'Deepgram Nova (cloud)';
  readonly description =
    'Sends the audio to Deepgram. Reports per-word confidence, which Beyond shows on the staff.';
  readonly requiresApiKey = true;
  readonly isLocal = false;

  readonly #model = 'nova-2';

  async available(): Promise<{ ok: boolean; reason?: string }> {
    return this.#key()
      ? { ok: true }
      : { ok: false, reason: 'Set VITE_DEEPGRAM_API_KEY in .env, or route through your own proxy.' };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    const key = this.#key();
    if (!key) throw new TranscriptionError('No Deepgram API key configured.', this.id);

    report(null, 'Preparing audio…');
    const samples = await toMono16k(request.audio.buffer);
    const wav = encodeWav(samples, 16_000);

    const params = new URLSearchParams({
      model: this.#model,
      smart_format: 'true',
      punctuate: 'true',
    });
    if (request.language === 'auto') params.set('detect_language', 'true');
    else params.set('language', request.language);

    report(null, 'Uploading…');

    const response = await fetch(`${this.#baseUrl()}/listen?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: wav,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok) {
      throw new TranscriptionError(
        `Deepgram returned ${response.status}: ${await response.text().catch(() => response.statusText)}`,
        this.id,
      );
    }

    const payload = (await response.json()) as DeepgramResponse;
    const channel = payload.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];

    const words: TranscriptWord[] = (alternative?.words ?? []).map((word) => {
      const base: TranscriptWord = {
        text: word.punctuated_word ?? word.word,
        startSec: word.start,
        endSec: word.end,
      };
      return word.confidence === undefined ? base : { ...base, confidence: word.confidence };
    });

    if (words.length === 0) {
      throw new TranscriptionError('Deepgram found no words in this audio.', this.id);
    }

    report(1, 'Transcript ready');

    return {
      language:
        request.language === 'auto' ? (channel?.detected_language ?? 'en') : request.language,
      languageDetected: request.language === 'auto',
      segments: groupWordsIntoSegments(sanitizeWords(words, request.audio.durationSec)),
      providerId: this.id,
      modelId: this.#model,
    };
  }

  #key(): string {
    return import.meta.env['VITE_DEEPGRAM_API_KEY'] ?? '';
  }

  #baseUrl(): string {
    return import.meta.env['VITE_DEEPGRAM_BASE_URL'] ?? 'https://api.deepgram.com/v1';
  }
}

export const deepgramProvider = new DeepgramProvider();
