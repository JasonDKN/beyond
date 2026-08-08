import { audioContext } from './decoder';
import { encodeWav } from './wav';

/**
 * Microphone capture for Practice mode.
 *
 * This records raw PCM straight off the Web Audio graph rather than going
 * through MediaRecorder.
 *
 * The obvious approach — MediaRecorder to a WebM/Opus blob, then
 * `decodeAudioData` to get samples back — has a fatal flaw for this use: it
 * compresses audio into a container only to immediately decompress it, and
 * every step of that round-trip is a place to fail. Which container the
 * browser picks, whether a short take produces a valid header, whether
 * `decodeAudioData` accepts a fragmented stream: all of it varies by browser
 * and none of it is needed, because what Practice mode wants is samples, and
 * samples are what the microphone already gives us.
 *
 * Capturing directly removes that entire class of failure. A WAV is encoded
 * afterwards purely so takes can be played back.
 *
 * Two other choices worth knowing about. The browser's default microphone
 * processing — echo cancellation, noise suppression, auto-gain — is tuned for
 * video calls and gates exactly the transients syllable timing is measured
 * from, so all three are off; that is safe because practice is on headphones.
 * And every take records where in the track it began, so onsets can be put
 * back on the song's timeline before scoring.
 */

export interface Take {
  readonly id: string;
  /** Where in the track recording began, in seconds. */
  readonly startedAtSec: number;
  readonly durationSec: number;
  /** Mono PCM, at `sampleRate`. This is what gets analysed. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** WAV encoding of the same audio, for playback only. */
  readonly blob: Blob;
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

/**
 * The worklet, inlined.
 *
 * Shipped as a Blob URL rather than a separate file so it needs no bundler
 * configuration and cannot go missing from a deployed build. It does the least
 * possible work: copy each block of input samples and post it back.
 */
const WORKLET_SOURCE = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // The buffer is reused between calls, so it must be copied before it
      // crosses the thread boundary.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}
registerProcessor('beyond-tap', TapProcessor);
`;

export class Recorder {
  #stream: MediaStream | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #node: AudioWorkletNode | ScriptProcessorNode | null = null;
  #sink: GainNode | null = null;
  #blocks: Float32Array[] = [];
  #recording = false;
  #startedAtSec = 0;
  #workletReady = false;

  get isRecording(): boolean {
    return this.#recording;
  }

  get armed(): boolean {
    return this.#stream !== null;
  }

  static supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioContext !== 'undefined'
    );
  }

  /**
   * Ask for the microphone and wire up the capture graph.
   *
   * Separate from `start` so the permission prompt happens when Practice mode
   * opens, not in the half-second before a take where it would swallow the
   * beginning of the recording.
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

    const context = audioContext();
    this.#source = context.createMediaStreamSource(this.#stream);
    this.#node = await this.#createTap(context);

    // The tap has to be connected to the destination for the graph to pull
    // audio through it — but at zero gain, or you would hear yourself with a
    // buffer's worth of delay, which is unbearable to perform over.
    this.#sink = context.createGain();
    this.#sink.gain.value = 0;
    this.#source.connect(this.#node);
    this.#node.connect(this.#sink);
    this.#sink.connect(context.destination);
  }

  /**
   * Build the capture node.
   *
   * AudioWorklet where available; ScriptProcessorNode where not. The latter is
   * deprecated and runs on the main thread, but it is universally supported
   * and for a few seconds of mono speech the cost is irrelevant. Better a
   * deprecated node than a mode that does not work.
   */
  async #createTap(context: AudioContext): Promise<AudioWorkletNode | ScriptProcessorNode> {
    if (context.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(context, 'beyond-tap');
        node.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (this.#recording) this.#blocks.push(event.data);
        };
        this.#workletReady = true;
        return node;
      } catch {
        // Fall through to the ScriptProcessor path.
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const node = context.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      if (this.#recording) this.#blocks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    return node;
  }

  /** True when capture is running on the modern path. Surfaced for diagnostics. */
  get usingWorklet(): boolean {
    return this.#workletReady;
  }

  start(playheadSec: number): void {
    if (!this.#node) throw new RecorderError('Microphone is not ready.', 'failed');
    this.#blocks = [];
    this.#startedAtSec = playheadSec;
    this.#recording = true;
  }

  /**
   * Stop and assemble the take. No decoding, so nothing here can fail on a
   * codec — the worst case is that nothing was captured, which is reported
   * plainly rather than as an error.
   */
  stop(): Take | null {
    if (!this.#recording) return null;
    this.#recording = false;

    const sampleRate = audioContext().sampleRate;
    // Take the blocks before clearing, so a late-arriving message from the
    // worklet cannot append to the array we are about to read.
    const blocks = this.#blocks;
    this.#blocks = [];

    const total = blocks.reduce((sum, block) => sum + block.length, 0);
    if (total === 0) return null;

    const samples = new Float32Array(total);
    let offset = 0;
    for (const block of blocks) {
      samples.set(block, offset);
      offset += block.length;
    }

    return {
      id: crypto.randomUUID(),
      startedAtSec: this.#startedAtSec,
      durationSec: total / sampleRate,
      samples,
      sampleRate,
      blob: encodeWav(samples, sampleRate),
      createdAt: Date.now(),
    };
  }

  /** Release the microphone; the browser's recording indicator goes away. */
  release(): void {
    this.#recording = false;
    this.#blocks = [];
    this.#node?.disconnect();
    this.#source?.disconnect();
    this.#sink?.disconnect();
    this.#node = null;
    this.#source = null;
    this.#sink = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }
}
