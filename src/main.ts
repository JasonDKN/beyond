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
import { mountApp } from '@/ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Beyond could not find its mount point (#app).');

mountApp(root);
