import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
