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

export async function syncReminders(reminders: Reminder[]): Promise<boolean> {
  const stored = readStored();
  if (!stored) return false;
  try {
    const res = await fetch('/api/push/sync-reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({
        subscriptionId: stored.subscriptionId,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
        reminders: buildSyncPayload(reminders),
      }),
    });
    if (res.status === 401) {
      // Server forgot us (e.g. pruned): drop local state so the next enablePush() re-subscribes.
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}
