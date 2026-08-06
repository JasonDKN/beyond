import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Where the app will be served from.
 *
 * GitHub Pages puts a project site under a subpath — `/beyond/` — so every
 * asset URL has to be prefixed or the page loads a blank screen with 404s in
 * the console. Netlify, Vercel and `npm run dev` all serve from the root.
 *
 * Driven by an environment variable rather than hard-coded, so one config
 * serves all of them: the Pages workflow sets BEYOND_BASE, nothing else needs
 * to.
 */
const base = process.env['BEYOND_BASE'] ?? '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // transformers.js pulls in onnxruntime-web, which ships its own wasm.
    // Excluding it keeps Vite from trying to pre-bundle the binaries.
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The lexicon and the ONNX runtime are both large on purpose, and both are
    // lazily loaded — warning about them on every build is just noise.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('cmu-pronouncing-dictionary')) return 'lexicon-en';
          if (id.includes('@huggingface') || id.includes('onnxruntime')) return 'asr';
          return undefined;
        },
      },
    },
  },
  server: {
    // Required for the multithreaded WASM backend used by local Whisper.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
