/**
 * Tracks scans that are in flight (reading a large file on the device, uploading, waiting for the AI). Anything that would
 * reload or swap the app (the long-session soft refresh in sessionFreshness.ts / App.tsx) must treat "a scan is running" as busy,
 * otherwise a reload would kill the request and the user sees a scan that "failed" with no error at all.
 * A safety expiry keeps a leaked counter (a bug, a killed promise) from blocking refreshes forever.
 */
const MAX_SCAN_AGE_MS = 5 * 60_000;
const active = new Map<number, number>();
let nextId = 1;

/** Marks a scan as started; call the returned function when it ends (success, failure or cancel). Safe to call twice. */
export function beginScan(now: () => number = Date.now): () => void {
  const id = nextId++;
  active.set(id, now());
  return () => { active.delete(id); };
}

export function isScanInFlight(now: number = Date.now()): boolean {
  for (const [id, startedAt] of active) {
    if (now - startedAt > MAX_SCAN_AGE_MS || now < startedAt) active.delete(id);
  }
  return active.size > 0;
}

/** Test helper. */
export function resetScanActivity(): void {
  active.clear();
}
