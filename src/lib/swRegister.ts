/**
 * Service worker registration + a NON-DISRUPTIVE update flow.
 *
 * public/sw.js no longer calls skipWaiting() on install. A new version therefore installs in the background and WAITS:
 *   - it takes over by itself on the next cold start (when every tab / the installed app has been closed), or
 *   - immediately when the user taps "Refresh" in the update banner (we post SKIP_WAITING, then reload once on controllerchange).
 * The page is never reloaded on focus / visibility change / resume, and never reloaded by the update without a user tap.
 */

export const SW_UPDATE_EVENT = 'docmind:sw-update';
export const UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60_000;

export interface SwUpdateDetail {
  /** Activates the waiting worker and reloads the page once it has taken control. */
  apply: () => void;
}

export function shouldCheckForUpdate(lastCheck: number, now: number, minInterval = UPDATE_CHECK_MIN_INTERVAL_MS): boolean {
  return !Number.isFinite(lastCheck) || now - lastCheck >= minInterval || now < lastCheck;
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  let refreshing = false;
  let userRequested = false;

  const announce = (waiting: ServiceWorker) => {
    const detail: SwUpdateDetail = {
      apply: () => {
        userRequested = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      },
    };
    window.dispatchEvent(new CustomEvent<SwUpdateDetail>(SW_UPDATE_EVENT, { detail }));
  };

  // Only a deliberate "Refresh" tap may reload. (controllerchange also fires for the very first claim; that must not reload.)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userRequested || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const start = () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) announce(installing);
          });
        });
        // Long-lived installed apps rarely navigate: look for a new version when the user comes back (throttled, no reload).
        let last = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (!shouldCheckForUpdate(last, now)) return;
          last = now;
          reg.update().catch(() => { /* offline: try again next time */ });
        });
      },
      (err) => console.warn('DocuMind ServiceWorker registration failed:', err),
    );
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
