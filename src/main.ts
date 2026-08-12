import '@/transcription'; // registers the transcription providers
import '@/phonetics/registry'; // registers the phonetic engines
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/app.css';
import '@/styles/staff.css';
import '@/styles/score.css';
import '@/styles/learn.css';
import '@/styles/meaning.css';
import '@/styles/modes.css';
import '@/styles/library.css';
import '@/styles/trackbar.css';
import '@/styles/practice.css';
import '@/styles/tips.css';
// Last, so its media queries override the desktop layout rather than losing to it.
import '@/styles/mobile.css';
import { mountApp } from '@/ui/app';
import { registerServiceWorker, requestPersistentStorage } from '@/offline';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Beyond could not find its mount point (#app).');

mountApp(root);

// Offline and durable storage, in that order of visibility: one lets the app
// open on a plane, the other keeps your work from being swept up as cache.
registerServiceWorker();
void requestPersistentStorage();
