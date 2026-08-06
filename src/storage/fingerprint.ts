/**
 * A stable identity for a piece of audio.
 *
 * Keying saved work on the file name is a trap: rename the file, re-encode it
 * at a different bitrate, or re-rip it from the CD, and an hour of tapping
 * silently detaches from the song it belongs to.
 *
 * So identity comes from the sound instead. This is not an acoustic
 * fingerprint in the Shazam sense — it will not match a live version to a
 * studio one, and it is not meant to. It answers a narrower question: is this
 * the same recording I was working on before? For that, a coarse loudness
 * profile is enough, and being coarse is exactly what makes it survive
 * re-encoding.
 *
 * The method: chop the track into a fixed number of windows, take the RMS of
 * each, normalise, and quantise hard. Small sample-level differences from a
 * different codec vanish in the quantisation; a different song does not.
 */

/** Windows across the track. Enough to be distinctive, few enough to be coarse. */
const WINDOW_COUNT = 64;
/** Loudness levels. Deliberately few — this is the re-encode tolerance. */
const LEVELS = 12;

/**
 * FNV-1a, 32-bit. A cryptographic hash would be pointless here: nobody is
 * attacking this, and we want something short, fast and dependency-free.
 */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Reduce samples to a quantised loudness profile.
 * Exported for testing — the profile is the whole substance of the id.
 */
export function loudnessProfile(samples: Float32Array): Uint8Array {
  const profile = new Uint8Array(WINDOW_COUNT);
  if (samples.length === 0) return profile;

  const windowSize = Math.max(1, Math.floor(samples.length / WINDOW_COUNT));
  const rms = new Float32Array(WINDOW_COUNT);

  let peak = 0;
  for (let w = 0; w < WINDOW_COUNT; w += 1) {
    const start = w * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 1) {
      const sample = samples[i]!;
      sum += sample * sample;
      count += 1;
    }
    const value = count > 0 ? Math.sqrt(sum / count) : 0;
    rms[w] = value;
    if (value > peak) peak = value;
  }

  if (peak === 0) return profile;

  for (let w = 0; w < WINDOW_COUNT; w += 1) {
    // Cube root, as elsewhere: loudness is perceived closer to this than to
    // raw amplitude, so the levels are spread where the ear notices them.
    const normalized = Math.cbrt(rms[w]! / peak);
    profile[w] = Math.min(LEVELS - 1, Math.floor(normalized * LEVELS));
  }
  return profile;
}

/**
 * The track id: a loudness hash plus a coarse duration bucket.
 *
 * Duration is bucketed to whole seconds so that a trailing silence trimmed by
 * one encoder and not another does not split one song into two entries.
 */
export function fingerprint(samples: Float32Array, durationSec: number): string {
  const profile = loudnessProfile(samples);
  const seconds = Math.round(durationSec);
  return `${fnv1a(profile)}-${seconds}`;
}

/** Downmix an AudioBuffer to mono for fingerprinting. */
export function monoSamples(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mixed[i] = mixed[i]! + data[i]!;
  }
  const scale = 1 / buffer.numberOfChannels;
  for (let i = 0; i < length; i += 1) mixed[i] = mixed[i]! * scale;
  return mixed;
}

export function fingerprintBuffer(buffer: AudioBuffer): string {
  return fingerprint(monoSamples(buffer), buffer.duration);
}

/** The pre-fingerprint key, kept so old saved work can still be found. */
export function legacyKey(name: string, durationSec: number): string {
  return `${name}::${durationSec.toFixed(1)}`;
}
