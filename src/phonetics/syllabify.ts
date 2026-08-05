import type { Phone, Syllable } from '@/core/types';

/**
 * Sonority-based syllabification.
 *
 * Singers care about syllables more than phonemes: a syllable is the unit that
 * gets a note, a breath, and a melisma. We split with the Maximum Onset
 * Principle — push as many consonants as legally possible onto the *following*
 * syllable's onset — constrained by a list of clusters English actually allows
 * word-initially. Without that constraint, "extra" would syllabify as e-.kstɹə,
 * which no English speaker sings.
 */

/** Onset clusters that are legal word-initially in English. */
const LEGAL_ONSETS = new Set([
  // Stop + liquid/glide
  'pl',
  'pɹ',
  'pj',
  'bl',
  'bɹ',
  'bj',
  'tɹ',
  'tw',
  'tj',
  'dɹ',
  'dw',
  'dj',
  'kl',
  'kɹ',
  'kw',
  'kj',
  'ɡl',
  'ɡɹ',
  'ɡw',
  // Fricative + liquid/glide/nasal
  'fl',
  'fɹ',
  'fj',
  'θɹ',
  'θw',
  'θj',
  'ʃɹ',
  'sl',
  'sw',
  'sj',
  'sm',
  'sn',
  'sp',
  'st',
  'sk',
  'sf',
  'vj',
  'hj',
  // s + stop + liquid/glide
  'spl',
  'spɹ',
  'spj',
  'stɹ',
  'stj',
  'skl',
  'skɹ',
  'skw',
  'skj',
  // Nasal + glide
  'mj',
  'nj',
]);

/**
 * Sonority ranks, low (most consonantal) to high (most vocalic). Used to reject
 * onsets that fall in sonority, which is universally dispreferred.
 */
const SONORITY: Readonly<Record<string, number>> = {
  p: 1,
  b: 1,
  t: 1,
  d: 1,
  k: 1,
  ɡ: 1,
  tʃ: 2,
  dʒ: 2,
  f: 3,
  v: 3,
  θ: 3,
  ð: 3,
  s: 3,
  z: 3,
  ʃ: 3,
  ʒ: 3,
  h: 3,
  m: 4,
  n: 4,
  ŋ: 4,
  l: 5,
  ɹ: 5,
  r: 5,
  w: 6,
  j: 6,
};

function sonority(phone: Phone): number {
  return SONORITY[phone.ipa] ?? 3;
}

function isLegalOnset(cluster: readonly Phone[]): boolean {
  if (cluster.length <= 1) return true;
  const key = cluster.map((p) => p.ipa).join('');
  if (LEGAL_ONSETS.has(key)) return true;
  // Allow unlisted clusters only if sonority rises strictly across them; this
  // keeps loanwords and non-English languages working without a bespoke list.
  for (let i = 1; i < cluster.length; i += 1) {
    if (sonority(cluster[i]!) <= sonority(cluster[i - 1]!)) return false;
  }
  return true;
}

/**
 * Split a phone sequence into syllables.
 *
 * Returns a single consonant-only "syllable" for words with no vowel at all
 * (initialisms like `mm`, or a G2P failure) rather than throwing, so the UI
 * always has something to render.
 */
export function syllabify(phones: readonly Phone[]): Syllable[] {
  const nucleusIndices: number[] = [];
  phones.forEach((phone, index) => {
    if (phone.isVowel) nucleusIndices.push(index);
  });

  if (nucleusIndices.length === 0) {
    return phones.length === 0
      ? []
      : [{ onset: [...phones], nucleus: [], coda: [], stress: 0 }];
  }

  const syllables: Syllable[] = [];

  for (let n = 0; n < nucleusIndices.length; n += 1) {
    const nucleusIndex = nucleusIndices[n]!;
    const prevNucleus = n === 0 ? -1 : nucleusIndices[n - 1]!;
    const nextNucleus = n === nucleusIndices.length - 1 ? phones.length : nucleusIndices[n + 1]!;

    // Consonants sitting between the previous nucleus and this one.
    const between = phones.slice(prevNucleus + 1, nucleusIndex);

    // Maximum Onset Principle: take the longest legal suffix of `between`
    // as this syllable's onset. The first syllable takes all of it — a word
    // cannot begin with a coda.
    let onsetStart = 0;
    if (n > 0) {
      onsetStart = between.length;
      for (let start = 0; start < between.length; start += 1) {
        const candidate = between.slice(start);
        if (isLegalOnset(candidate)) {
          onsetStart = start;
          break;
        }
      }
    }

    const onset = between.slice(onsetStart);
    const codaOfPrevious = between.slice(0, onsetStart);
    if (n > 0 && codaOfPrevious.length > 0) {
      const previous = syllables[syllables.length - 1]!;
      syllables[syllables.length - 1] = {
        ...previous,
        coda: [...previous.coda, ...codaOfPrevious],
      };
    }

    // The final syllable absorbs every trailing consonant as its coda.
    const coda =
      n === nucleusIndices.length - 1 ? phones.slice(nucleusIndex + 1, nextNucleus) : [];

    const nucleus = [phones[nucleusIndex]!];
    syllables.push({
      onset,
      nucleus,
      coda,
      stress: nucleus[0]?.stress ?? 0,
    });
  }

  return syllables;
}

/** Flatten a syllable back into its phone sequence. */
export function syllablePhones(syllable: Syllable): Phone[] {
  return [...syllable.onset, ...syllable.nucleus, ...syllable.coda];
}
