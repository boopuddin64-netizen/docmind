/**
 * In-page alert scheduler (runs while the app is open, and on every start-up to catch missed alerts).
 * The pure planning function is unit-tested; the DOM glue lives in notifications.ts / App.tsx.
 */
import { buildSyncPayload, describeEvent, eligibleEvents } from './schedule';
import type { Reminder } from '../types';

export const FIRED_STORAGE_KEY = 'docmind_fired_alerts_v1';
export const FIRED_RETENTION_MS = 7 * 24 * 3600 * 1000;
export const MAX_LATE_MS = 6 * 3600 * 1000;
export const MAX_INDIVIDUAL_NOTIFICATIONS = 4;

export type FiredMap = Record<string, number>;

export interface PlannedNotification {
  tag: string;
  title: string;
  body: string;
  reminderId?: string;
}

export interface Plan {
  notifications: PlannedNotification[];
  fired: FiredMap;
  /** Number of newly-fired events (before summarising). */
  newEvents: number;
}

export function pruneFired(fired: FiredMap, now: number): FiredMap {
  const out: FiredMap = {};
  for (const [k, t] of Object.entries(fired)) if (typeof t === 'number' && now - t < FIRED_RETENTION_MS) out[k] = t;
  return out;
}

/**
 * Decide which notifications to show right now. Events already in `fired` are never repeated.
 * Many simultaneous events (e.g. re-opening the app after a day) collapse into a single summary notification.
 */
export function planAlerts(reminders: Reminder[], fired: FiredMap, now: number): Plan {
  const next = pruneFired(fired, now);
  const synced = buildSyncPayload(reminders, now);
  const events = eligibleEvents(synced, now, { maxLateMs: MAX_LATE_MS }).filter((e) => !(e.key in next));
  for (const e of events) next[e.key] = now;

  let notifications: PlannedNotification[];
  if (events.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
    notifications = [
      {
        tag: 'docmind-summary',
        title: `${events.length} reminders need your attention`,
        body: events.slice(0, 3).map((e) => e.reminder.title).join(', ') + (events.length > 3 ? '…' : ''),
      },
    ];
  } else {
    notifications = events.map((e) => {
      const d = describeEvent(e, now);
      return { tag: e.id, title: d.title, body: d.body, reminderId: e.id };
    });
  }
  return { notifications, fired: next, newEvents: events.length };
}

/** Milliseconds until the next event that has not fired yet (used to sleep precisely instead of only polling). */
export function nextEventDelay(reminders: Reminder[], fired: FiredMap, now: number): number | null {
  const synced = buildSyncPayload(reminders, now);
  let best: number | null = null;
  for (const r of synced) {
    const cands = [
      ...(r.leadMinutes > 0 ? [r.dueAt - r.leadMinutes * 60_000] : []),
      r.dueAt,
      ...(r.snoozedUntil ? [r.snoozedUntil] : []),
    ];
    for (const at of cands) if (at > now && (best === null || at - now < best)) best = at - now;
  }
  return best;
}

/** Event keys the service worker already displayed via Web Push (stored in Cache Storage under /__fired/<key>). */
export async function loadPushFiredKeys(): Promise<string[]> {
  try {
    if (typeof caches === 'undefined') return [];
    const cache = await caches.open('docmind-fired');
    const reqs = await cache.keys();
    return reqs.map((r) => decodeURIComponent(new URL(r.url).pathname.replace('/__fired/', '')));
  } catch {
    return [];
  }
}
