/// <reference lib="webworker" />

/**
 * Local Whisper, off the main thread.
 *
 * transformers.js runs ONNX Whisper in WebGPU where available and WASM
 * everywhere else. Either way it will happily block a thread for a minute at a
 * time, which would freeze the waveform mid-scrub — hence the worker.
 *
 * The audio never leaves the machine.
 */

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

export interface WorkerRequest {
  readonly type: 'transcribe';
  readonly id: string;
  readonly audio: Float32Array;
  readonly language: string | null;
  readonly modelId: string;
  readonly device: 'webgpu' | 'wasm';
}

export interface WorkerChunk {
  readonly text: string;
  readonly timestamp: readonly [number, number | null];
}

export type WorkerResponse =
  | { type: 'ready'; id: string }
  | { type: 'progress'; id: string; ratio: number | null; message: string }
  | { type: 'result'; id: string; text: string; chunks: WorkerChunk[]; language: string | null }
  | { type: 'error'; id: string; message: string };

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string; chunks?: WorkerChunk[] }>;

let transcriber: Transcriber | null = null;
let loadedKey = '';

async function getTranscriber(
  modelId: string,
  device: 'webgpu' | 'wasm',
  id: string,
): Promise<Transcriber> {
  const key = `${modelId}:${device}`;
  if (transcriber && loadedKey === key) return transcriber;

  const created = await pipeline('automatic-speech-recognition', modelId, {
    device,
    // q4 on WebGPU is roughly 4× smaller than fp32 and, for speech, very close
    // in quality. On WASM, fp32 encoder / q8 decoder is the stable combination.
    dtype:
      device === 'webgpu'
        ? { encoder_model: 'fp16', decoder_model_merged: 'q4' }
        : { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: (event: { status?: string; progress?: number; file?: string }) => {
      if (event.status === 'progress' && typeof event.progress === 'number') {
        post({
          type: 'progress',
          id,
          ratio: event.progress / 100,
          message: `Downloading model${event.file ? ` — ${event.file}` : ''}…`,
        });
      }
    },
  });

  transcriber = created as unknown as Transcriber;
  loadedKey = key;
  return transcriber;
}

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'transcribe') return;

  void (async () => {
    try {
      post({ type: 'progress', id: request.id, ratio: null, message: 'Preparing model…' });
      const run = await getTranscriber(request.modelId, request.device, request.id);

      post({ type: 'progress', id: request.id, ratio: null, message: 'Listening…' });

      const output = await run(request.audio, {
        // Word timestamps are what make the staff possible — without them there
        // is nothing to illuminate in time.
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        language: request.language ?? undefined,
        task: 'transcribe',
      });

      post({
        type: 'result',
        id: request.id,
        text: output.text ?? '',
        chunks: output.chunks ?? [],
        language: request.language,
      });
    } catch (error) {
      post({
        type: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

post({ type: 'ready', id: 'boot' });
