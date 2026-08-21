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

// Bumped whenever the caching rules change: `activate` deletes every cache
// that is not this one, so a rename is also how old entries get swept up.
const CACHE = 'beyond-v2';

/**
 * Is this URL safe to keep forever?
 *
 * Only if its name contains its contents. Vite fingerprints what it builds —
 * `app-B2kQ7xZ1.js` — so a changed file arrives under a changed name and a
 * cache hit can never be stale. Everything else on this origin keeps a stable
 * name across versions: the manifest, the icons, and (in development, where
 * this worker should never be running at all) every module of the app.
 */
function isFingerprinted(pathname) {
  return /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(pathname);
}

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
      const immutable = isFingerprinted(url.pathname);

      // A fingerprinted file can never change under its own name, so a hit is
      // the end of it. This is the path the large assets take — the English
      // lexicon, the speech model — fetched once and then owned by the device.
      if (cached && immutable) return cached;

      const network = fetch(request)
        .then(async (fresh) => {
          // Opaque and error responses are not worth keeping; a cached 404
          // would outlive the mistake that caused it.
          if (fresh.ok && fresh.type === 'basic') {
            const cache = await caches.open(CACHE);
            await cache.put(request, fresh.clone());
          }
          return fresh;
        })
        .catch((error) => {
          if (cached) return cached;
          throw error;
        });

      /*
       * Everything else: answer from cache at once, and refresh behind it.
       *
       * Names that stay the same across versions — the manifest, the icons —
       * were previously cached first and never looked at again, which meant a
       * changed one could only be updated by clearing site data. Serving the
       * copy we have keeps the app instant and keeps it working offline; the
       * fetch alongside means the next load has the new one.
       */
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      return network;
    })(),
  );
});
