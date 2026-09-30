import { useEffect, useLayoutEffect, useRef } from 'react';
import { clearDraft, flushPendingWrites, restoreScroll, scheduleDraft, type SnapshotTab, type UiSnapshot } from './persistedState';

/**
 * Saves `value` as a draft while `dirty`, removes the draft when the form is back to its pristine state.
 * The value is written debounced and flushed on pagehide / hidden (see useFlushOnHide in App).
 */
export function useDraftSaver(name: string, value: unknown, dirty: boolean, sig?: string): void {
  const json = JSON.stringify(value);
  const wasDirty = useRef(false);
  useEffect(() => {
    if (dirty) scheduleDraft(name, value, sig);
    // Only a dirty -> pristine transition (submit / cancel / revert) deletes the stored draft. Deleting on the first pass would
    // destroy the draft that a restoring component is about to read (and React StrictMode runs effects twice in dev).
    else if (wasDirty.current) clearDraft(name);
    wasDirty.current = dirty;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, json, dirty, sig]);
}

/** Flushes debounced writes when the page is hidden / being frozen. NEVER reloads or navigates. */
export function useFlushOnHide(flush: () => void): void {
  const ref = useRef(flush);
  ref.current = flush;
  useEffect(() => {
    const run = () => ref.current();
    const onVis = () => { if (document.visibilityState === 'hidden') run(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', run); // bfcache-friendly (unload / beforeunload are deliberately NOT used)
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', run);
    };
  }, []);
}

export { flushPendingWrites };

/**
 * Remembers window scroll per tab and restores it when a tab is (re)shown, including after a cold start.
 * Events that fire while a restore is in progress (the browser clamps the scroll when the page height changes) are ignored,
 * so they cannot overwrite the position that is being restored.
 */
export function useScrollMemory(tab: SnapshotTab, initial: UiSnapshot['scroll']) {
  const map = useRef<UiSnapshot['scroll']>({ ...initial });
  const tabRef = useRef<SnapshotTab>(tab);
  const locked = useRef(true);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (locked.current || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = Math.round(window.scrollY);
        if (y > 0) map.current[tabRef.current] = y;
        else delete map.current[tabRef.current];
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useLayoutEffect(() => {
    tabRef.current = tab;
    locked.current = true;
    let unlock: ReturnType<typeof setTimeout> | undefined;
    const cancel = restoreScroll(
      map.current[tab] ?? 0,
      {
        getHeight: () => document.documentElement.scrollHeight,
        viewport: () => window.innerHeight,
        scrollTo: (y) => window.scrollTo(0, y),
        requestFrame: (cb) => requestAnimationFrame(() => cb()),
      },
      30,
      () => { unlock = setTimeout(() => { locked.current = false; }, 120); },
    );
    return () => {
      cancel();
      if (unlock) clearTimeout(unlock);
    };
  }, [tab]);

  return map;
}
