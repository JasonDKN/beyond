import { registerProvider } from './provider';
import { lyricsProvider } from './providers/lyrics';
import { whisperLocal } from './providers/whisper-local';
import { openAIProvider } from './providers/openai';
import { deepgramProvider } from './providers/deepgram';
import { demoProvider } from './providers/demo';

/**
 * Registration order is menu order, and the lyric sheet goes first.
 *
 * For the job this app is actually for — learning a song whose words you
 * already have — supplying the lyrics beats guessing at them. Whisper stays
 * one menu item away for when you genuinely do not know what was sung.
 */
registerProvider(lyricsProvider);
registerProvider(whisperLocal);
registerProvider(openAIProvider);
registerProvider(deepgramProvider);
registerProvider(demoProvider);

export const DEFAULT_PROVIDER_ID = lyricsProvider.id;

export * from './provider';
export { lyricsProvider, whisperLocal, openAIProvider, deepgramProvider, demoProvider };
