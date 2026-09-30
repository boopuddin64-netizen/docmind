/**
 * Pure (DOM-free, Node-free) text for reminder notifications. ONE formatter is used by the push server (payload builder),
 * the in-page scheduler and the test notification, so an on-time, early, overdue, snoozed and test alert all read the same:
 *
 *   Title:  "Bill: Electricity"                     (short category prefix when the category is specific)
 *   Body:   "Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)"
 *           "₦45,000 · Ikeja Electric"               (key detail: amount and/or issuer)
 *           "March 2026 statement"                    (short description, only when there is room)
 *
 * Everything is plain text (notifications never render HTML), control characters are stripped so a scanned document
 * cannot inject extra lines, and long text is cut at a word boundary with an ellipsis (never mid-emoji).
 */

import type { NotifyStage } from './schedule.js';

export const MAX_TITLE_CHARS = 64;
export const MAX_LINE_CHARS = 72;
export const MAX_BODY_LINES = 3;
/** Cap for the synced `detail` field (kept small: it is stored on the push server). */
export const MAX_DETAIL_CHARS = 160;
export const MAX_CATEGORY_LABEL_CHARS = 16;

export interface NotificationSubject {
  title: string;
  dueAt: number;
  /** Short category label, e.g. "Bill". Optional. */
  category?: string;
  /** Key detail lines ("₦45,000 · Ikeja Electric\nMarch statement"), newline separated. Optional. */
  detail?: string;
  /** No usable time on the reminder: show the date only. */
  allDay?: boolean;
}

/** Collapses whitespace, strips control / zero-width / bidi-override characters. */
export function cleanText(input: unknown): string {
  return String(input ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts to `max` characters at a word boundary (when one is reasonably close) and appends "…". Counts code points. */
export function truncateText(input: unknown, max: number): string {
  const s = cleanText(input);
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, max - 1).join('');
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(max * 0.6) ? head.slice(0, lastSpace) : head;
  return cut.replace(/[\s,;:.\-–—·(\[]+$/u, '') + '…';
}

const CATEGORY_LABELS: Record<string, string> = {
  'Medical': 'Medical',
  'Dental': 'Dental',
  'Checkup': 'Checkup',
  'Prescription': 'Prescription',
  'Lab Tests': 'Lab test',
  'Specialist': 'Specialist',
  'Bills & Invoices': 'Bill',
  'Contracts & Legal': 'Legal',
  'Vehicle & Home': 'Vehicle/Home',
  'Work & Study': 'Work/Study',
  'Subscriptions': 'Subscription',
  // 'General' intentionally has no prefix: it says nothing.
};

/** Short prefix for a reminder category, or '' when the category adds no information. */
export function categoryLabel(category: unknown): string {
  const c = cleanText(category);
  if (!c || /^general$/i.test(c)) return '';
  return truncateText(CATEGORY_LABELS[c] ?? c, MAX_CATEGORY_LABEL_CHARS);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Wall { y: number; mo: number; d: number; wd: number; h: number; min: number }

/** Wall-clock fields of an instant. tzOffsetMinutes uses getTimezoneOffset's sign (UTC - local); omitted => runtime local zone. */
function wallClock(ms: number, tzOffsetMinutes?: number): Wall {
  if (typeof tzOffsetMinutes === 'number' && Number.isFinite(tzOffsetMinutes)) {
    const d = new Date(ms - tzOffsetMinutes * 60_000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
  }
  const d = new Date(ms);
  return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), wd: d.getDay(), h: d.getHours(), min: d.getMinutes() };
}

/** "Thu, 15 Oct 2026" */
export function formatDueDate(ms: number, tzOffsetMinutes?: number): string {
  const w = wallClock(ms, tzOffsetMinutes);
  return `${WEEKDAYS[w.wd]}, ${w.d} ${MONTHS[w.mo]} ${w.y}`;
}

/** "9:30 AM" (no leading zero) */
export function formatDueTime(ms: number, tzOffsetMinutes?: number): string {
  const w = wallClock(ms, tzOffsetMinutes);
  return `${w.h % 12 || 12}:${String(w.min).padStart(2, '0')} ${w.h >= 12 ? 'PM' : 'AM'}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

function span(minutes: number): string {
  if (minutes < 60) return plural(Math.max(1, minutes), 'minute');
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m >= 5 && h < 6 ? `${plural(h, 'hour')} ${m} min` : plural(Math.round(minutes / 60), 'hour');
  }
  return plural(Math.round(minutes / (24 * 60)), 'day');
}

/** Whole calendar days from `now` to `due` in the target zone (both read as wall-clock dates). */
function calendarDayDiff(dueMs: number, now: number, tz?: number): number {
  const a = wallClock(dueMs, tz);
  const b = wallClock(now, tz);
  return Math.round((Date.UTC(a.y, a.mo, a.d) - Date.UTC(b.y, b.mo, b.d)) / 86_400_000);
}

/** "in 1 hour", "in 30 minutes", "now", "overdue by 2 hours", "today", "tomorrow", "overdue by 3 days". */
export function formatRelative(dueAt: number, now: number, opts: { allDay?: boolean; tzOffsetMinutes?: number } = {}): string {
  if (opts.allDay) {
    const days = calendarDayDiff(dueAt, now, opts.tzOffsetMinutes);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1) return `in ${plural(days, 'day')}`;
    return days === -1 ? 'overdue by 1 day' : `overdue by ${plural(-days, 'day')}`;
  }
  const diffMin = Math.round((dueAt - now) / 60_000);
  if (Math.abs(dueAt - now) < 45_000 || diffMin === 0) return 'now';
  return diffMin > 0 ? `in ${span(diffMin)}` : `overdue by ${span(-diffMin)}`;
}

/** "Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)" / "Due: Thu, 15 Oct 2026 (today)" */
export function formatDueLine(s: Pick<NotificationSubject, 'dueAt' | 'allDay'>, now: number, tzOffsetMinutes?: number): string {
  const date = formatDueDate(s.dueAt, tzOffsetMinutes);
  const when = s.allDay ? date : `${date} at ${formatDueTime(s.dueAt, tzOffsetMinutes)}`;
  return `Due: ${when} (${formatRelative(s.dueAt, now, { allDay: s.allDay, tzOffsetMinutes })})`;
}

export function formatNotificationTitle(s: Pick<NotificationSubject, 'title' | 'category'>): string {
  const prefix = categoryLabel(s.category);
  const title = cleanText(s.title) || 'Reminder';
  if (!prefix) return truncateText(title, MAX_TITLE_CHARS);
  // The prefix is short and never cut; the reminder title gets the remaining room.
  return `${prefix}: ${truncateText(title, Math.max(12, MAX_TITLE_CHARS - prefix.length - 2))}`;
}

/**
 * 2-3 line body: the due line, an optional "Snoozed reminder" note, then the key detail lines while there is room.
 * Every line is individually truncated.
 */
export function formatNotificationBody(s: NotificationSubject, stage: NotifyStage, now: number, tzOffsetMinutes?: number): string {
  const lines = [truncateText(formatDueLine(s, now, tzOffsetMinutes), MAX_LINE_CHARS)];
  if (stage === 'snooze') lines.push('Snoozed reminder');
  const detail = String(s.detail ?? '').split(/\r\n|\r|\n/).map((l) => truncateText(l, MAX_LINE_CHARS)).filter(Boolean);
  for (const l of detail) {
    if (lines.length >= MAX_BODY_LINES) break;
    lines.push(l);
  }
  return lines.join('\n');
}

export function formatNotification(s: NotificationSubject, stage: NotifyStage, now: number, tzOffsetMinutes?: number): { title: string; body: string } {
  return { title: formatNotificationTitle(s), body: formatNotificationBody(s, stage, now, tzOffsetMinutes) };
}

/** The "test alert" notification, in the same shape as a real reminder. */
export function formatTestNotification(now: number, tzOffsetMinutes?: number): { title: string; body: string } {
  return {
    title: 'Test: DocuMind alert',
    body: [formatDueLine({ dueAt: now }, now, tzOffsetMinutes), 'Alerts are working on this device.'].join('\n'),
  };
}

// ───────────── building the synced `category` / `detail` from a reminder ─────────────

const AMOUNT_RE = /(?:[₦$£€¥₹]|\b(?:NGN|USD|GBP|EUR|CAD|AUD|INR|ZAR|KES|GHS)\b\s?|\b(?:N|Rs\.?)\s?(?=\d))\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k|K|million|m))?/;

/** First money-looking amount in the given texts ("₦45,000", "$1,250.50", "USD 300"), else ''. */
export function extractAmount(...texts: Array<string | undefined>): string {
  for (const t of texts) {
    const m = AMOUNT_RE.exec(cleanText(t).slice(0, 4000));
    if (m) return cleanText(m[0]);
  }
  return '';
}

export interface DetailSource {
  hospitalName?: string;
  diagnosis?: string;
  shortNote?: string;
  fullText?: string;
  category?: string;
}

/** Key detail for the notification body: "amount · issuer" first, then a short description when different. */
export function buildNotificationDetail(r: DetailSource): string {
  const issuer = cleanText(r.hospitalName);
  const amount = extractAmount(r.shortNote, r.diagnosis, r.fullText);
  const description = cleanText(r.shortNote) || cleanText(r.diagnosis);
  const lines: string[] = [];
  const first = [amount, issuer].filter(Boolean).join(' · ');
  if (first) lines.push(truncateText(first, MAX_LINE_CHARS));
  if (description && description.toLowerCase() !== issuer.toLowerCase()) lines.push(truncateText(description, MAX_LINE_CHARS));
  return lines.join('\n').slice(0, MAX_DETAIL_CHARS);
}
