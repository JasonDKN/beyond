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
