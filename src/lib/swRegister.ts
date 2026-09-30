/**
 * Service worker registration + a NON-DISRUPTIVE update flow.
 *
 * public/sw.js no longer calls skipWaiting() on install. A new version therefore installs in the background and WAITS:
 *   - it takes over by itself on the next cold start (when every tab / the installed app has been closed), or
 *   - immediately when the user taps "Refresh" in the update banner (we post SKIP_WAITING, then reload once on controllerchange).
 * A quick return to the app never reloads it. The ONLY automatic refresh is the long-session rule in sessionFreshness.ts
 * (away >= 30 min, or a page older than 8 h that was away >= 1 min) and only when no modal / draft is open (refreshApp below).
 */

export const SW_UPDATE_EVENT = 'docmind:sw-update';
export const UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60_000;

export interface SwUpdateDetail {
  /** Activates the waiting worker and reloads the page once it has taken control. */
  apply: () => void;
}

/** The waiting update (if any), so the long-session refresh can apply it. */
let pendingUpdate: SwUpdateDetail | null = null;
export function getPendingUpdate(): SwUpdateDetail | null {
  return pendingUpdate;
}

/**
 * Soft refresh used after a long absence: applies a waiting service worker (it reloads once on controllerchange) or, when
 * none is waiting, reloads the page (navigations are network-first, so the newest build is fetched).
 */
export function refreshApp(): void {
  if (pendingUpdate) {
    pendingUpdate.apply();
    // Safety net: if the waiting worker vanished (no controllerchange), still refresh.
    setTimeout(() => window.location.reload(), 4000);
  } else window.location.reload();
}

/** Shows the non-intrusive update banner even when no service worker update is waiting (Refresh then simply reloads). */
export function announceRefreshAvailable(): void {
  const detail: SwUpdateDetail = pendingUpdate ?? { apply: () => window.location.reload() };
  window.dispatchEvent(new CustomEvent<SwUpdateDetail>(SW_UPDATE_EVENT, { detail }));
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
    pendingUpdate = detail;
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
