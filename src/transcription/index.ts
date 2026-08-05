import { registerProvider } from './provider';
import { whisperLocal } from './providers/whisper-local';
import { openAIProvider } from './providers/openai';
import { deepgramProvider } from './providers/deepgram';
import { demoProvider } from './providers/demo';

/** Registration order is menu order — the local, no-key provider goes first. */
registerProvider(whisperLocal);
registerProvider(openAIProvider);
registerProvider(deepgramProvider);
registerProvider(demoProvider);

export const DEFAULT_PROVIDER_ID = whisperLocal.id;

export * from './provider';
export { whisperLocal, openAIProvider, deepgramProvider, demoProvider };
