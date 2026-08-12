/*
 * Offline, so a song you packed before a trip still opens on a plane.
 *
 * Two strategies, chosen by what the request is for:
 *
 *   Navigations go to the network first and fall back to the cached page. That
 *   way a deploy is picked up the moment you have signal, and the app still
 *   opens when you do not.
 *
 *   Everything else is cache-first. Vite fingerprints its output, so a changed
 *   file arrives under a changed name — serving a hit from cache can never be
 *   stale, and the huge assets (the English lexicon, the speech model) are
 *   fetched once and then belong to the device.
 *
 * Nothing is pre-cached on install. Pre-caching would mean deciding to pull
 * tens of megabytes of model weights onto a phone that may never ask for them;
 * caching what you actually use is both smaller and better targeted.
 */

const CACHE = 'beyond-v1';

self.addEventListener('install', () => {
  // Take over as soon as possible; there is no old version worth protecting.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only this origin. Fonts and anything else third-party are left to the
  // browser's own cache, which already handles them well.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          // A start_url variant may be cached under a different query string.
          const fallback = await caches.match(new URL('./', self.location.href).href);
          if (fallback) return fallback;
          throw new Error('offline and not cached');
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const fresh = await fetch(request);
      // Opaque and error responses are not worth keeping; a cached 404 would
      // outlive the mistake that caused it.
      if (fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
