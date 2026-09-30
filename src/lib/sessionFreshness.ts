/**
 * Long-session freshness ("don't keep a stale app alive forever").
 *
 * Short trips away from the app (switching apps, locking the phone) keep the page and its state untouched. Only after a LONG
 * time away, or a very long-lived page, is the app refreshed the next time it comes back to the foreground, so a Home Screen PWA
 * that is never cold-started still picks up new versions. UI state survives a refresh via the snapshot / drafts (persistedState).
 * A refresh never happens while a modal or an unsaved draft is open: then the (non-intrusive) update banner is shown instead.
 *
 * Works in the iOS standalone PWA: it relies on `visibilitychange` + `pageshow` (bfcache / resume), not on unload events.
 */

/** Refresh on return when the app was in the background at least this long. */
export const HIDDEN_REFRESH_AFTER_MS = 30 * 60_000;
/** Refresh on return when this page load is at least this old ... */
export const SESSION_MAX_AGE_MS = 8 * 3600_000;
/** ... but only if the app was also away at least this long (so a quick app switch is never interrupted). */
export const SESSION_AGE_MIN_HIDDEN_MS = 60_000;

export type FreshnessDecision = 'none' | 'refresh' | 'defer';

export interface FreshnessInput {
  now: number;
  /** When the page went to the background; null = it was not hidden. */
  hiddenAt: number | null;
  /** When this page load started. */
  sessionStart: number;
  /** A modal / unsaved draft is open. */
  busy: boolean;
}

export function decideFreshness(i: FreshnessInput): FreshnessDecision {
  if (i.hiddenAt === null) return 'none';
  const hiddenFor = i.now - i.hiddenAt;
  const age = i.now - i.sessionStart;
  if (!Number.isFinite(hiddenFor) || !Number.isFinite(age) || hiddenFor < 0 || age < 0) return 'none'; // clock moved backwards: do nothing
  const stale = hiddenFor >= HIDDEN_REFRESH_AFTER_MS || (age >= SESSION_MAX_AGE_MS && hiddenFor >= SESSION_AGE_MIN_HIDDEN_MS);
  if (!stale) return 'none';
  return i.busy ? 'defer' : 'refresh';
}

export interface FreshnessDeps {
  now: () => number;
  isVisible: () => boolean;
  /** true while a modal or an unsaved draft is open */
  isBusy: () => boolean;
  /** Flush UI state to storage right before refreshing. */
  saveState: () => void;
  /** Soft refresh: applies a waiting service worker (which reloads) or reloads the page. */
  refresh: () => void;
  /** Busy: surface the update banner instead. */
  defer: () => void;
  addDocListener: (type: 'visibilitychange', fn: () => void) => void;
  removeDocListener: (type: 'visibilitychange', fn: () => void) => void;
  addWinListener: (type: 'pageshow' | 'pagehide', fn: () => void) => void;
  removeWinListener: (type: 'pageshow' | 'pagehide', fn: () => void) => void;
}

export function installSessionFreshness(deps: FreshnessDeps, sessionStart: number = deps.now()): () => void {
  let hiddenAt: number | null = null;
  const onHidden = () => { if (hiddenAt === null) hiddenAt = deps.now(); };
  const onReturn = () => {
    const decision = decideFreshness({ now: deps.now(), hiddenAt, sessionStart, busy: deps.isBusy() });
    hiddenAt = null;
    if (decision === 'refresh') { deps.saveState(); deps.refresh(); }
    else if (decision === 'defer') deps.defer();
  };
  const onVisibility = () => (deps.isVisible() ? onReturn() : onHidden());
  deps.addDocListener('visibilitychange', onVisibility);
  deps.addWinListener('pagehide', onHidden);
  deps.addWinListener('pageshow', onReturn);
  return () => {
    deps.removeDocListener('visibilitychange', onVisibility);
    deps.removeWinListener('pagehide', onHidden);
    deps.removeWinListener('pageshow', onReturn);
  };
}

export function browserFreshnessDeps(over: Pick<FreshnessDeps, 'isBusy' | 'saveState' | 'refresh' | 'defer'>): FreshnessDeps {
  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === 'visible',
    addDocListener: (t, f) => document.addEventListener(t, f),
    removeDocListener: (t, f) => document.removeEventListener(t, f),
    addWinListener: (t, f) => window.addEventListener(t, f),
    removeWinListener: (t, f) => window.removeEventListener(t, f),
    ...over,
  };
}
