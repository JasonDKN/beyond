import type { Transcript, TranscriptWord } from '@/core/types';
import type { TranscriptionProvider, TranscriptionRequest } from '../provider';
import { groupWordsIntoSegments, progressReporter, sanitizeWords } from '../provider';

/**
 * A transcript with no model behind it.
 *
 * Two jobs. First, UI work: you can iterate on the staff, the type, the
 * animation and the export without waiting 90 seconds for Whisper every reload.
 * Second, it is the reference implementation of the provider interface —
 * about forty lines, which is the whole point of the interface being small.
 */

const LYRIC = [
  'Beyond the edge of every ordinary word',
  'a second language waits inside the sound',
  'the vowels open slowly like a door',
  'and everything you sang is written down',
];

class DemoProvider implements TranscriptionProvider {
  readonly id = 'demo';
  readonly label = 'Demo transcript (no model)';
  readonly description =
    'Fabricates a timed lyric so you can work on the interface without running a model.';
  readonly requiresApiKey = false;
  readonly isLocal = true;

  async available(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcript> {
    const report = progressReporter(request.onProgress);
    report(0.5, 'Fabricating a transcript…');
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Lay the lyric over however long the real file actually is, so the staff
    // and the audio still line up while you are working on the UI.
    const duration = Math.max(8, request.audio.durationSec);
    const lineSpan = duration / LYRIC.length;
    const words: TranscriptWord[] = [];

    LYRIC.forEach((line, lineIndex) => {
      const tokens = line.split(' ');
      const wordSpan = (lineSpan * 0.82) / tokens.length;
      tokens.forEach((token, wordIndex) => {
        const start = lineIndex * lineSpan + wordIndex * wordSpan;
        words.push({
          text: token,
          startSec: start,
          endSec: start + wordSpan * 0.9,
          confidence: 0.97,
        });
      });
    });

    report(1, 'Transcript ready');

    return {
      language: request.language === 'auto' ? 'en' : request.language,
      languageDetected: false,
      segments: groupWordsIntoSegments(sanitizeWords(words, duration), {
        gapSec: 0.35,
        maxWords: 10,
        maxDurationSec: 12,
      }),
      providerId: this.id,
      modelId: 'demo-fixture',
    };
  }
}

export const demoProvider = new DemoProvider();
