import { audioContext } from './decoder';

/**
 * Microphone capture for Practice mode.
 *
 * Two things make this different from a generic voice recorder.
 *
 * First, the browser's default microphone processing is actively harmful here.
 * Echo cancellation, noise suppression and auto-gain are tuned for video calls:
 * they duck, gate and reshape exactly the transients that syllable timing is
 * measured from. All three are switched off. That is safe because you are on
 * headphones — there is no speaker bleed for echo cancellation to remove.
 *
 * Second, a take is only meaningful next to the moment in the song it belongs
 * to, so every recording carries the playhead position it started at. Onsets
 * are converted back onto the track's own timeline before anything is scored.
 */

export interface Take {
  readonly id: string;
  /** Where in the track recording began, in seconds. */
  readonly startedAtSec: number;
  readonly durationSec: number;
  readonly blob: Blob;
  /** Decoded audio, kept for analysis and instant replay. */
  readonly buffer: AudioBuffer;
  readonly createdAt: number;
}

export class RecorderError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'unsupported' | 'failed',
  ) {
    super(message);
    this.name = 'RecorderError';
  }
}

export class Recorder {
  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];
  #startedAtSec = 0;

  get isRecording(): boolean {
    return this.#recorder?.state === 'recording';
  }

  static supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /**
   * Ask for the microphone.
   *
   * Kept separate from `start` so the permission prompt can happen when you
   * open Practice mode rather than in the half-second before a take, where it
   * would swallow the beginning of the recording.
   */
  async arm(): Promise<void> {
    if (this.#stream) return;
    if (!Recorder.supported()) {
      throw new RecorderError('This browser cannot record audio.', 'unsupported');
    }

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      throw new RecorderError(
        denied
          ? 'Microphone access was declined. Allow it in your browser to use Practice mode.'
          : 'No microphone is available.',
        denied ? 'denied' : 'failed',
      );
    }
  }

  /** Whether the mic is live — used to show the permission state. */
  get armed(): boolean {
    return this.#stream !== null;
  }

  start(playheadSec: number): void {
    if (!this.#stream) throw new RecorderError('Microphone is not ready.', 'failed');
    if (this.isRecording) return;

    this.#chunks = [];
    this.#startedAtSec = playheadSec;
    this.#recorder = new MediaRecorder(this.#stream, { mimeType: pickMimeType() });
    this.#recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    this.#recorder.start(200);
  }

  /** Stop and decode. Resolves once the take is ready to analyse. */
  async stop(): Promise<Take | null> {
    const recorder = this.#recorder;
    if (!recorder || recorder.state === 'inactive') return null;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(this.#chunks, { type: recorder.mimeType })),
        { once: true },
      );
      recorder.stop();
    });
    this.#recorder = null;

    if (blob.size === 0) return null;

    let buffer: AudioBuffer;
    try {
      buffer = await audioContext().decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new RecorderError('The recording could not be decoded.', 'failed');
    }

    return {
      id: crypto.randomUUID(),
      startedAtSec: this.#startedAtSec,
      durationSec: buffer.duration,
      blob,
      buffer,
      createdAt: Date.now(),
    };
  }

  /** Release the microphone. The browser shows a recording indicator until this runs. */
  release(): void {
    this.#recorder = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }
}

/**
 * Pick a container the browser will actually produce.
 *
 * Safari and Chrome disagree here, and an unsupported mimeType makes the
 * MediaRecorder constructor throw rather than fall back.
 */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}
