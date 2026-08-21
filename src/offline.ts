/**
 * Making Beyond behave like something installed rather than something visited.
 *
 * Two separate promises, both of which matter to the same person — the one who
 * packed a fortnight of work onto a phone and then got on a plane.
 *
 * The service worker is the offline half: the app opens with no signal.
 *
 * Persistent storage is the *durability* half, and it is the less obvious of
 * the two. Browsers treat ordinary site storage as disposable and reclaim it
 * under pressure or after a stretch of disuse — WebKit in particular caps
 * script-writable storage at about a week without interaction. A song you
 * packed on Friday and did not open until the following weekend could simply
 * be gone. Asking for persistence, and installing to the home screen, are what
 * move that data from "cache" to "yours".
 */

/** Where the app is served from — `/` locally, `/beyond/` on Pages. */
const scope = new URL(import.meta.env.BASE_URL, location.href);

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Only over https or localhost; anywhere else the registration throws and
  // there is nothing to be done about it.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  /*
   * Never in development.
   *
   * The worker serves assets cache-first, which is safe in a build because
   * Vite fingerprints its output: changed code arrives under a changed name,
   * so a cache hit can never be stale. The dev server fingerprints nothing —
   * `/src/ui/app.ts` is that URL forever — so the same rule caches every
   * module of one session and serves them back in the next. The dev server
   * then reports compiling your edits while the browser quietly runs the code
   * you wrote yesterday, and the deployed site is fine, which makes it look
   * like the local checkout is behind.
   *
   * Registering only in a build kills that at the source. A worker installed
   * by an earlier version is still out there, though, and would go on serving
   * its cache forever, so development also cleans up after it.
   */
  if (!import.meta.env.PROD) {
    void unregisterEverything();
    return;
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(new URL('sw.js', scope).href, { scope: scope.href })
      .catch(() => {
        // Offline support is a bonus, never a requirement. A browser that
        // refuses it still runs the whole app.
      });
  });
}

/**
 * Remove any worker and cache this origin is carrying, then reload once.
 *
 * Only ever called in development. The reload matters: unregistering does not
 * evict the worker controlling the page you are already looking at, so without
 * it the stale copy stays on screen and it takes a manual purge in DevTools to
 * be rid of it. One reload, only when there was something to remove, and the
 * page comes back from the dev server.
 */
async function unregisterEverything(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('beyond-')).map((n) => caches.delete(n)));

    if (registrations.length > 0 && navigator.serviceWorker.controller) location.reload();
  } catch {
    // Nothing here is required for the app to run.
  }
}

/**
 * Ask the browser to treat this site's storage as worth keeping.
 *
 * Granted silently on installed web apps and on sites you use often; declined
 * elsewhere, which is not an error and not worth telling anyone about.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
