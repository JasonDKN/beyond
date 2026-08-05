import type { AudioSource, ProgressHandler } from '@/core/types';

/** Formats the browser will usually decode. Not exhaustive — we try anyway. */
export const ACCEPTED_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
];

export const ACCEPT_ATTRIBUTE = '.mp3,.wav,.flac,.ogg,.m4a,.aac,.webm,.opus,audio/*';

export class DecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecodeError';
  }
}

let sharedContext: AudioContext | null = null;

/**
 * A single shared AudioContext.
 *
 * Browsers cap the number of contexts a page may create, and each one costs a
 * hardware audio thread. One context, created lazily on the first user gesture,
 * is both the polite and the reliable choice.
 */
export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

/** Read a File into a decoded AudioSource, reporting progress as it goes. */
export async function decodeFile(file: File, onProgress?: ProgressHandler): Promise<AudioSource> {
  onProgress?.({ stage: 'decode', ratio: 0, message: `Reading ${file.name}…` });

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (cause) {
    throw new DecodeError(`Could not read ${file.name}.`, { cause });
  }

  onProgress?.({ stage: 'decode', ratio: 0.4, message: 'Decoding audio…' });

  const context = audioContext();
  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches the ArrayBuffer, so hand it a copy — the caller
    // may still want the original bytes for a cloud provider upload.
    buffer = await context.decodeAudioData(bytes.slice(0));
  } catch (cause) {
    throw new DecodeError(
      `${file.name} is not an audio format this browser can decode. Try WAV, MP3, FLAC, or M4A.`,
      { cause },
    );
  }

  onProgress?.({ stage: 'decode', ratio: 1, message: 'Audio ready' });

  return {
    name: file.name,
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    buffer,
    objectUrl: URL.createObjectURL(file),
  };
}

/**
 * Mono, 16 kHz Float32 — the shape every Whisper-family model expects.
 * Uses an OfflineAudioContext so the resampling is done by the browser's own
 * (good) resampler rather than by naive index arithmetic.
 */
export async function toMono16k(buffer: AudioBuffer, targetRate = 16_000): Promise<Float32Array> {
  if (buffer.sampleRate === targetRate && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }

  const frames = Math.ceil((buffer.duration * targetRate) as number);
  const offline = new OfflineAudioContext(1, Math.max(1, frames), targetRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;

  // Downmix explicitly rather than relying on the default, so a stereo mix with
  // a hard-panned vocal does not lose half its energy.
  const merger = offline.createGain();
  merger.channelCount = 1;
  merger.channelCountMode = 'explicit';
  merger.channelInterpretation = 'speakers';

  source.connect(merger);
  merger.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export function releaseSource(source: AudioSource | null): void {
  if (source) URL.revokeObjectURL(source.objectUrl);
}
