/**
 * Pure (DOM-free, Node-free) scheduling logic for reminder notifications.
 *
 * Shared by the browser (in-page timers) and the push server (cron dispatch) so both compute
 * exactly the same "when does this reminder need to notify" answer, with the same de-dupe keys.
 */

export const DEFAULT_LEAD_MINUTES = 60;
export const MAX_LEAD_MINUTES = 7 * 24 * 60;

export type NotifyStage = 'lead' | 'due' | 'snooze';

/** Minimal, privacy-conscious reminder view that is synced to the push server. */
export interface SyncedReminder {
  id: string;
  title: string;
  /** Absolute due instant, epoch milliseconds (computed on the client in the user's own timezone). */
  dueAt: number;
  /** Minutes before dueAt to send a heads-up. 0 disables the heads-up. */
  leadMinutes: number;
  /** Epoch ms until which alerts are snoozed. */
  snoozedUntil?: number | null;
}

export interface ScheduledEvent {
  /** Stable de-dupe key: the same event never fires twice. */
  key: string;
  id: string;
  stage: NotifyStage;
  /** Epoch ms when this event becomes due. */
  at: number;
  reminder: SyncedReminder;
}

/** Reminders due outside [0, MAX_DUE_AT_MS] are rejected by the push server, so the client must not send them either (single source of truth). */
export const MAX_DUE_AT_MS = 4_102_444_800_000; // 2100-01-01T00:00:00Z

export function isSyncableInstant(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= MAX_DUE_AT_MS;
}

function realDate(y: number, m: number, d: number): boolean {
  if (!(y >= 1970 && y <= 2200) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Accepts DD/MM/YYYY (also - or .) and YYYY-MM-DD (also / or .). Returns null for anything else / impossible dates. */
export function parseDateParts(input: string | undefined | null): { y: number; m: number; d: number } | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return realDate(y, mo, d) ? { y, m: mo, d } : null;
  }
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return realDate(y, mo, d) ? { y, m: mo, d } : null;
  }
  return null;
}

/**
 * "10:00 AM", "7:05pm", "23:59", "12:00 AM" (=00:00), "9am". Missing / unparseable => 08:00 (same default as the ICS export).
 * - am/pm only counts when it is attached to the time (optional spaces, whole word): "12:00 Program" is 12:00, not 00:00.
 * - Ranges use the FIRST time: "9:00 AM - 5:00 PM" is 09:00.
 * - 12 AM = 00:xx, 12 PM = 12:xx.
 */
export function parseTimeOrNull(input: string | undefined | null): { h: number; min: number } | null {
  const raw = (typeof input === 'string' ? input : '').trim();
  const re = /\b(\d{1,2}):(\d{2})(?!\d)(?:\s*([ap])\.?m(?![A-Za-z]))?|\b(\d{1,2})\s*([ap])\.?m(?![A-Za-z])/i;
  const m = re.exec(raw);
  if (m) {
    let h = +(m[1] ?? m[4]);
    const min = m[2] ? +m[2] : 0;
    const mer = (m[3] ?? m[5])?.toLowerCase();
    if (h <= 23 && min <= 59) {
      if (mer === 'p' && h < 12) h += 12;
      if (mer === 'a' && h === 12) h = 0;
      return { h, min };
    }
  }
  return null;
}

export function parseTimeParts(input: string | undefined | null): { h: number; min: number } {
  return parseTimeOrNull(input) ?? { h: 8, min: 0 };
}

/**
 * Absolute due instant (epoch ms) for a reminder's wall-clock date + time.
 * - tzOffsetMinutes omitted: interpreted in the runtime's local timezone (correct, DST-aware, in the browser).
 * - tzOffsetMinutes given (same sign as Date#getTimezoneOffset, i.e. UTC - local): interpreted in that fixed offset.
 */
export function computeDueAt(date: string, time: string, tzOffsetMinutes?: number): number | null {
  const d = parseDateParts(date);
  if (!d) return null;
  const t = parseTimeParts(time);
  if (typeof tzOffsetMinutes === 'number' && Number.isFinite(tzOffsetMinutes)) {
    return Date.UTC(d.y, d.m - 1, d.d, t.h, t.min) + tzOffsetMinutes * 60_000;
  }
  return new Date(d.y, d.m - 1, d.d, t.h, t.min, 0, 0).getTime();
}

/** Whole calendar days from `now`'s local date to the given local calendar date (DST-safe, unlike ms/86_400_000). */
export function calendarDaysUntil(target: { y: number; m: number; d: number }, now: Date): number {
  const a = Date.UTC(target.y, target.m - 1, target.d);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function clampLeadMinutes(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_LEAD_MINUTES;
  return Math.min(MAX_LEAD_MINUTES, Math.max(0, Math.floor(n)));
}

/** All notification events a reminder can produce. Snooze suppresses events earlier than the snooze end and adds a wake-up event. */
export function eventsFor(r: SyncedReminder): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  const s = typeof r.snoozedUntil === 'number' && Number.isFinite(r.snoozedUntil) && r.snoozedUntil > 0 ? r.snoozedUntil : null;
  const lead = clampLeadMinutes(r.leadMinutes);
  const mk = (stage: NotifyStage, at: number, suffix = ''): ScheduledEvent => ({
    key: `${r.id}:${r.dueAt}:${stage}${suffix}`,
    id: r.id,
    stage,
    at,
    reminder: r,
  });
  if (lead > 0) {
    const at = r.dueAt - lead * 60_000;
    if (s === null || at >= s) out.push(mk('lead', at));
  }
  if (s === null || r.dueAt >= s) out.push(mk('due', r.dueAt));
  if (s !== null) out.push(mk('snooze', s, `:${s}`));
  return out;
}

export interface EligibleOptions {
  /** Ignore events that became due longer ago than this (avoids blasting stale alerts after long downtime). */
  maxLateMs: number;
}

/**
 * Events that should fire right now: already due, not too old, and (for the heads-up) the reminder itself
 * is not yet due (once due, the "due" event supersedes the heads-up).
 */
export function eligibleEvents(reminders: SyncedReminder[], now: number, opts: EligibleOptions): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const r of reminders) {
    for (const ev of eventsFor(r)) {
      if (ev.at > now) continue;
      if (now - ev.at > opts.maxLateMs) continue;
      if (ev.stage === 'lead' && now >= r.dueAt) continue;
      out.push(ev);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function formatClock(ms: number, tzOffsetMinutes?: number): string {
  const d = new Date(typeof tzOffsetMinutes === 'number' ? ms - tzOffsetMinutes * 60_000 : ms);
  const useUtc = typeof tzOffsetMinutes === 'number';
  const h = useUtc ? d.getUTCHours() : d.getHours();
  const m = useUtc ? d.getUTCMinutes() : d.getMinutes();
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Human text for a notification. Kept generic; the caller decides how much to show. */
export function describeEvent(ev: ScheduledEvent, now: number): { title: string; body: string } {
  const title = ev.reminder.title || 'Reminder';
  if (ev.stage === 'lead') {
    const mins = Math.max(1, Math.round((ev.reminder.dueAt - now) / 60_000));
    return { title, body: mins >= 60 ? `Due in about ${Math.round(mins / 60)} hour(s)` : `Due in ${mins} minute(s)` };
  }
  if (ev.stage === 'snooze') return { title, body: 'Snoozed reminder is due now' };
  return { title, body: 'Due now' };
}

/** Builds the (minimal) list synced to the push server from the app's reminders. Completed/invalid/very old ones are dropped. */
export function buildSyncPayload(
  reminders: Array<{
    id: string;
    eventTitle: string;
    appointmentDate: string;
    appointmentTime: string;
    isCompleted?: boolean;
    notificationSchedule?: { snoozedUntil?: string | null; leadMinutes?: number };
  }>,
  now: number = Date.now(),
  max = 500,
): SyncedReminder[] {
  const byId = new Map<string, SyncedReminder>();
  for (const r of reminders) {
    if (!r || r.isCompleted || typeof r.id !== 'string' || !r.id || r.id.length > 100) continue;
    const dueAt = computeDueAt(r.appointmentDate, r.appointmentTime);
    // Same range the server accepts (0 … MAX_DUE_AT_MS): one out-of-range item must never make the whole sync fail.
    if (dueAt === null || !isSyncableInstant(dueAt)) continue;
    const sn = r.notificationSchedule?.snoozedUntil ? Date.parse(r.notificationSchedule.snoozedUntil) : NaN;
    // Long-overdue reminders are dropped, unless the snooze has not ended yet: its wake-up alert must still reach the push server.
    if (dueAt < now - 24 * 3_600_000 && !(isSyncableInstant(sn) && sn > now)) continue;
    byId.set(r.id, {
      id: r.id,
      title: String(r.eventTitle || 'Reminder').slice(0, 120),
      dueAt,
      leadMinutes: clampLeadMinutes(r.notificationSchedule?.leadMinutes ?? DEFAULT_LEAD_MINUTES),
      snoozedUntil: isSyncableInstant(sn) ? sn : null,
    });
  }
  return [...byId.values()].sort((a, b) => a.dueAt - b.dueAt).slice(0, max);
}
