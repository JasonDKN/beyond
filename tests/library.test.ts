import { describe, expect, it } from 'vitest';
import { fingerprint, loudnessProfile, legacyKey } from '@/storage/fingerprint';
import { formatBytes, formatWhen } from '@/storage/library';

/**
 * The fingerprint is what keeps two songs' work apart, and what reunites a
 * renamed file with its timings. Both properties are worth testing directly.
 */

/** A repeatable pseudo-random signal — no Math.random, so failures reproduce. */
function noise(length: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

/** A signal with a distinctive loud/quiet shape, like a song's dynamics. */
function shaped(length: number, pattern: number[]): Float32Array {
  const out = new Float32Array(length);
  const band = Math.floor(length / pattern.length);
  for (let i = 0; i < length; i += 1) {
    const gain = pattern[Math.min(pattern.length - 1, Math.floor(i / band))] ?? 0;
    out[i] = Math.sin(i / 12) * gain;
  }
  return out;
}

describe('audio fingerprint', () => {
  it('is stable for identical audio', () => {
    const samples = shaped(200_000, [1, 0.2, 0.8, 0.4]);
    expect(fingerprint(samples, 180)).toBe(fingerprint(samples, 180));
  });

  it('does not depend on the file name — that is the whole point', () => {
    // Renaming a file cannot change its samples, so the id cannot change
    // either. The old key, by contrast, is a pure function of the name.
    const samples = shaped(200_000, [1, 0.2, 0.8, 0.4]);
    expect(fingerprint(samples, 180)).toBe(fingerprint(samples, 180));
    expect(legacyKey('song.mp3', 180)).not.toBe(legacyKey('song (1).mp3', 180));
  });

  it('separates two different songs', () => {
    const a = shaped(200_000, [1, 0.2, 0.8, 0.4]);
    const b = shaped(200_000, [0.3, 0.9, 0.1, 1]);
    expect(fingerprint(a, 180)).not.toBe(fingerprint(b, 180));
  });

  it('survives the small sample changes a re-encode introduces', () => {
    // A different codec perturbs samples slightly without altering the shape.
    // Quantising the loudness profile is what absorbs that.
    const original = shaped(200_000, [1, 0.25, 0.75, 0.5]);
    const reencoded = new Float32Array(original.length);
    const dither = noise(original.length, 7);
    for (let i = 0; i < original.length; i += 1) {
      reencoded[i] = original[i]! * 0.997 + dither[i]! * 0.002;
    }
    expect(fingerprint(reencoded, 180)).toBe(fingerprint(original, 180));
  });

  it('tolerates a second of trimmed silence', () => {
    const samples = shaped(200_000, [1, 0.25, 0.75, 0.5]);
    expect(fingerprint(samples, 180.4)).toBe(fingerprint(samples, 179.8));
  });

  it('handles silence and empty input without dividing by zero', () => {
    expect(() => fingerprint(new Float32Array(0), 0)).not.toThrow();
    expect(() => fingerprint(new Float32Array(1000), 10)).not.toThrow();
    expect([...loudnessProfile(new Float32Array(1000))].every((v) => v === 0)).toBe(true);
  });

  it('produces one level per window', () => {
    expect(loudnessProfile(shaped(100_000, [1, 0.5]))).toHaveLength(64);
  });
});

describe('library formatting', () => {
  it('scales byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('describes when you last worked on something', () => {
    const now = 1_700_000_000_000;
    expect(formatWhen(now - 30_000, now)).toBe('just now');
    expect(formatWhen(now - 20 * 60_000, now)).toBe('20 min ago');
    expect(formatWhen(now - 5 * 3_600_000, now)).toBe('5h ago');
    expect(formatWhen(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(formatWhen(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
});
