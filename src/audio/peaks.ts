import type { PeakEnvelope } from '@/core/types';

/**
 * Waveform envelope extraction.
 *
 * Drawing 10 million samples into 1200 pixels is both slow and wrong: it
 * aliases, and the result looks like noise. Instead we reduce to one min/max
 * pair per bucket, which is what makes a waveform look like a waveform, plus an
 * RMS value per bucket that drives how brightly the staff glows there.
 */
export function computePeaks(channelData: Float32Array, bucketCount: number): PeakEnvelope {
  const buckets = Math.max(1, Math.floor(bucketCount));
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / buckets));
  const peaks = new Float32Array(buckets * 2);
  const rms = new Float32Array(buckets);

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * samplesPerPeak;
    const end = Math.min(channelData.length, start + samplesPerPeak);

    let min = 0;
    let max = 0;
    let sumSquares = 0;
    let count = 0;

    for (let i = start; i < end; i += 1) {
      const sample = channelData[i]!;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      sumSquares += sample * sample;
      count += 1;
    }

    peaks[bucket * 2] = min;
    peaks[bucket * 2 + 1] = max;
    rms[bucket] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  }

  return { samplesPerPeak, length: buckets, peaks, rms };
}

/** Downmix every channel to one Float32Array for envelope purposes. */
export function mixdown(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);

  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mixed[i] = mixed[i]! + data[i]!;
  }
  const scale = 1 / channels;
  for (let i = 0; i < length; i += 1) mixed[i] = mixed[i]! * scale;
  return mixed;
}

/** Normalise RMS to 0–1 against the loudest bucket, for glow intensity. */
export function normalizedEnergy(envelope: PeakEnvelope): Float32Array {
  let max = 0;
  for (const value of envelope.rms) if (value > max) max = value;
  if (max === 0) return new Float32Array(envelope.length);

  const out = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    // Perceptual-ish curve: loudness is closer to a cube root of power than to
    // amplitude, and a linear map leaves quiet passages invisible.
    out[i] = Math.cbrt(envelope.rms[i]! / max);
  }
  return out;
}

/**
 * Crude onset detection over the RMS envelope — a rising-edge spectral-flux
 * stand-in. Used purely as decoration: onsets become the tick marks on the
 * staff, hinting at where the beat sits without claiming to be a beat tracker.
 */
export function detectOnsets(envelope: PeakEnvelope, sampleRate: number): number[] {
  const energy = normalizedEnergy(envelope);
  const secondsPerBucket = envelope.samplesPerPeak / sampleRate;
  const windowSize = Math.max(3, Math.round(0.25 / secondsPerBucket));
  const onsets: number[] = [];

  let lastOnsetBucket = -Infinity;
  for (let i = 1; i < energy.length; i += 1) {
    const flux = Math.max(0, energy[i]! - energy[i - 1]!);

    let localSum = 0;
    let localCount = 0;
    for (let j = Math.max(0, i - windowSize); j < Math.min(energy.length, i + windowSize); j += 1) {
      localSum += energy[j]!;
      localCount += 1;
    }
    const localMean = localCount > 0 ? localSum / localCount : 0;

    const isPeak = flux > 0.06 && energy[i]! > localMean * 1.15;
    const farEnough = i - lastOnsetBucket > windowSize * 0.6;
    if (isPeak && farEnough) {
      onsets.push(i * secondsPerBucket);
      lastOnsetBucket = i;
    }
  }
  return onsets;
}
