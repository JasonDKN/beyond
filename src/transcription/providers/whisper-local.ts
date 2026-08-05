import { toMono16k } from '@/audio/decoder';
import type { Transcript, TranscriptWord } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import {
  groupWordsIntoSegments,
  progressReporter,
  sanitizeWords,
  TranscriptionError,
} from '../provider';
import type { WorkerRequest, WorkerResponse } from '../worker/whisper.worker';

/**
 * The default provider: Whisper, in this browser, on this machine.
 *
 * No key, no upload, no per-minute cost, and it works on a plane. The model is
 * fetched once from the Hugging Face CDN and then cached by the browser.
 */

export interface WhisperOptions {
  /** Any ONNX Whisper repo. `base` is the sweet spot for song lyrics. */
  modelId: string;
}

const DEFAULT_MODEL = 'onnx-community/whisper-base';

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

class LocalWhisperProvider implements TranscriptionProvider {
  readonly id = 'whisper-local';
  readonly label = 'Whisper (on this device)';
  readonly description =
    'Runs the Whisper model in your browser. Nothing is uploaded; the first run downloads the model.';
  readonly requiresApiKey = false;
  readonly isLocal = true;

  #worker: Worker | null = null;
  #options: WhisperOptions = { modelId: DEFAULT_MODEL };

  configure(options: Partial<WhisperOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  async available(): Promise<{ ok: boolean; reason?: string }> {
    if (typeof Worker === 'undefined') {
      return { ok: false, reason: 'This browser has no Web Worker support.' };
    }
    if (typeof WebAssembly === 'undefined') {
      return { ok: false, reason: 'This browser has no WebAssembly support.' };
    }
    return { ok: true };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    report(null, 'Resampling to 16 kHz…');

    const samples = await toMono16k(request.audio.buffer);
    const device = await pickDevice();
    const worker = this.#ensureWorker();
    const jobId = crypto.randomUUID();

    report(
      null,
      device === 'webgpu' ? 'Warming up the GPU…' : 'Warming up (CPU — this one takes a while)…',
    );

    const result = await new Promise<Extract<WorkerResponse, { type: 'result' }>>(
      (resolve, reject) => {
        const onAbort = (): void => {
          cleanup();
          reject(new TranscriptionError('Transcription cancelled.', this.id));
        };

        const onMessage = (event: MessageEvent<WorkerResponse>): void => {
          const message = event.data;
          if (message.id !== jobId && message.type !== 'ready') return;
          switch (message.type) {
            case 'progress':
              report(message.ratio, message.message);
              break;
            case 'result':
              cleanup();
              resolve(message);
              break;
            case 'error':
              cleanup();
              reject(new TranscriptionError(message.message, this.id));
              break;
            default:
              break;
          }
        };

        const cleanup = (): void => {
          worker.removeEventListener('message', onMessage);
          request.signal?.removeEventListener('abort', onAbort);
        };

        worker.addEventListener('message', onMessage);
        request.signal?.addEventListener('abort', onAbort, { once: true });

        const payload: WorkerRequest = {
          type: 'transcribe',
          id: jobId,
          audio: samples,
          language: request.language === 'auto' ? null : request.language,
          modelId: this.#options.modelId,
          device,
        };
        // Transfer the sample buffer rather than copying it — a five-minute
        // song at 16 kHz is 19 MB, and structured cloning it is pure waste.
        worker.postMessage(payload, [samples.buffer]);
      },
    );

    report(1, 'Transcript ready');

    const words = sanitizeWords(toWords(result.chunks), request.audio.durationSec);
    if (words.length === 0) {
      throw new TranscriptionError(
        'No speech was found in this file. If the vocal is buried in the mix, try an isolated vocal stem.',
        this.id,
      );
    }

    return {
      language: request.language === 'auto' ? (result.language ?? 'en') : request.language,
      languageDetected: request.language === 'auto',
      segments: groupWordsIntoSegments(words),
      providerId: this.id,
      modelId: this.#options.modelId,
    };
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  #ensureWorker(): Worker {
    this.#worker ??= new Worker(new URL('../worker/whisper.worker.ts', import.meta.url), {
      type: 'module',
      name: 'beyond-whisper',
    });
    return this.#worker;
  }
}

/**
 * Whisper's word chunks sometimes have a null end timestamp on the final word
 * of a stride. Carry the next chunk's start backwards to close the gap rather
 * than dropping the word.
 */
function toWords(chunks: readonly { text: string; timestamp: readonly [number, number | null] }[]): TranscriptWord[] {
  return chunks
    .map((chunk, index) => {
      const start = chunk.timestamp[0] ?? 0;
      const explicitEnd = chunk.timestamp[1];
      const nextStart = chunks[index + 1]?.timestamp[0];
      const end = explicitEnd ?? nextStart ?? start + 0.25;
      return { text: chunk.text.trim(), startSec: start, endSec: end };
    })
    .filter((word) => word.text.length > 0);
}

export const whisperLocal = new LocalWhisperProvider();
