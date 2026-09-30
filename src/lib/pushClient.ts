/**
 * Browser side of Web Push: subscribe/unsubscribe and keep the server's copy of the reminders in sync.
 * Only the minimum needed to fire an alert is sent (id, title, absolute due time, lead time, snooze end).
 */
import type { Reminder } from '../types';
import { buildSyncPayload } from './schedule';

const STORAGE_KEY = 'docmind_push_sub_v1';

interface StoredPush {
  subscriptionId: string;
  token: string;
  endpoint: string;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function readStored(): StoredPush | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return v && v.subscriptionId && v.token && v.endpoint ? v : null;
  } catch {
    return null;
  }
}

export function isPushActive(): boolean {
  return readStored() !== null;
}

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing.active ? existing : await navigator.serviceWorker.ready;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Subscribes this browser to push (requires notification permission to be already granted). Returns true when active. */
export async function enablePush(reminders: Reminder[]): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const keyRes = await fetch('/api/push/public-key');
    if (!keyRes.ok) return false; // server without VAPID keys: in-page alerts only
    const { publicKey } = await keyRes.json();
    const reg = await getRegistration();
    if (!reg) return false;

    let sub = await reg.pushManager.getSubscription();
    const stored = readStored();
    if (sub && stored && stored.endpoint === sub.endpoint) {
      await syncReminders(reminders);
      return true;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ subscriptionId: data.subscriptionId, token: data.token, endpoint: sub.endpoint } satisfies StoredPush),
    );
    await syncReminders(reminders);
    return true;
  } catch (e) {
    console.warn('Push subscription failed:', e);
    return false;
  }
}

export async function disablePush(): Promise<void> {
  const stored = readStored();
  localStorage.removeItem(STORAGE_KEY);
  try {
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* ignore */
  }
  if (stored) {
    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
        body: JSON.stringify({ subscriptionId: stored.subscriptionId }),
      });
    } catch {
      /* server unreachable: the server prunes dead subscriptions itself on the next 404/410 */
    }
  }
}

const SYNC_RETRY_DELAYS_MS = [1_000, 4_000];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SyncOutcome {
  ok: boolean;
  /** Reminders the server refused (invalid) while accepting the rest. */
  skipped?: number;
  status?: number;
}

/**
 * Sends the reminders to the server and checks the response. Retries transient failures (network / 5xx / 429) with a
 * short backoff; 401 drops local state (server forgot us); other 4xx are not retried. Failures are logged, not swallowed.
 */
export async function syncRemindersDetailed(
  reminders: Reminder[],
  opts: { retryDelaysMs?: number[]; fetchImpl?: typeof fetch; log?: (...a: unknown[]) => void } = {},
): Promise<SyncOutcome> {
  const stored = readStored();
  if (!stored) return { ok: false };
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((...a: unknown[]) => console.warn(...a));
  const delays = opts.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  const body = JSON.stringify({
    subscriptionId: stored.subscriptionId,
    tzOffsetMinutes: new Date().getTimezoneOffset(),
    reminders: buildSyncPayload(reminders),
  });
  for (let attempt = 0; ; attempt++) {
    let status: number | undefined;
    try {
      const res = await doFetch('/api/push/sync-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
        body,
      });
      status = res.status;
      if (res.status === 401) {
        // Server forgot us (e.g. pruned): drop local state so the next enablePush() re-subscribes.
        localStorage.removeItem(STORAGE_KEY);
        log('[push] sync rejected (401): subscription is unknown to the server, will re-subscribe');
        return { ok: false, status };
      }
      if (res.ok) {
        let skipped = 0;
        try { skipped = Number((await res.json())?.skipped) || 0; } catch { /* body is informational */ }
        if (skipped > 0) log(`[push] server skipped ${skipped} invalid reminder(s) during sync`);
        return { ok: true, skipped, status };
      }
      log(`[push] sync failed with HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429 && res.status !== 408) return { ok: false, status }; // not retryable
    } catch (e) {
      log('[push] sync failed (network):', e);
    }
    if (attempt >= delays.length) return { ok: false, status };
    await sleep(delays[attempt]);
  }
}

export async function syncReminders(reminders: Reminder[]): Promise<boolean> {
  return (await syncRemindersDetailed(reminders)).ok;
}

export type TestPushResult =
  | { ok: true }
  | { ok: false; reason: 'not-subscribed' | 'rate-limited' | 'gone' | 'unavailable' | 'error'; message: string };

/**
 * Asks the server to send ONE real push to this device's own subscription (bearer-authenticated with the token from
 * subscribe time). The notification then arrives through the same path as a real reminder, so it shows whether it pops up.
 */
export async function sendTestPush(fetchImpl: typeof fetch = fetch): Promise<TestPushResult> {
  const stored = readStored();
  if (!stored) return { ok: false, reason: 'not-subscribed', message: 'Push is not set up on this device yet. Allow notifications first.' };
  try {
    const res = await fetchImpl('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({ subscriptionId: stored.subscriptionId }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 410) {
      localStorage.removeItem(STORAGE_KEY); // server forgot this device: the next enablePush() re-subscribes
      return { ok: false, reason: 'gone', message: 'This device was unsubscribed. Turn notifications off and on again, then retry.' };
    }
    if (res.status === 429) return { ok: false, reason: 'rate-limited', message: 'Please wait a few seconds before sending another test.' };
    if (res.status === 503) return { ok: false, reason: 'unavailable', message: 'Push is not configured on the server.' };
    return { ok: false, reason: 'error', message: 'The test notification could not be sent. Try again in a moment.' };
  } catch {
    return { ok: false, reason: 'error', message: 'Could not reach the server. Check your connection.' };
  }
}
