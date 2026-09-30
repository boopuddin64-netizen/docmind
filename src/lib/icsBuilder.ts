/**
 * Pure (DOM-free) iCalendar builder shared by the browser helper (icalHelper.ts)
 * and the Express endpoint (server.ts) so the two can no longer drift apart.
 */

import { parseTimeParts } from './schedule.js';

export interface IcsInput {
  title?: string;
  note?: string;
  location?: string;
  recipient?: string;
  date?: string; // DD/MM/YYYY, YYYY-MM-DD or anything Date can parse
  time?: string; // "08:00 AM", "14:30"
  now?: Date; // injectable for tests
}

/** Escape a TEXT value per RFC 5545 (also neutralises CR/LF injection of extra properties). */
export function escapeIcsText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseIcsDate(input: string | undefined, fallback: Date): { y: number; m: number; d: number } {
  const def = { y: fallback.getFullYear(), m: fallback.getMonth() + 1, d: fallback.getDate() };
  const raw = (input || '').trim();
  if (!raw) return def;

  const dmy = raw.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (dmy) {
    const [d, m, y] = [+dmy[1], +dmy[2], +dmy[3]];
    return isRealDate(y, m, d) ? { y, m, d } : def;
  }
  const ymd = raw.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
  if (ymd) {
    const [y, m, d] = [+ymd[1], +ymd[2], +ymd[3]];
    return isRealDate(y, m, d) ? { y, m, d } : def;
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
  }
  return def;
}

/** true when the input is empty (today is used) or a real date; false for garbage or impossible dates (e.g. 31/02/2026). */
export function isValidIcsDateInput(input: string | undefined): boolean {
  const raw = (input || '').trim();
  if (!raw) return true;
  const dmy = raw.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (dmy) return isRealDate(+dmy[3], +dmy[2], +dmy[1]);
  const ymd = raw.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
  if (ymd) return isRealDate(+ymd[1], +ymd[2], +ymd[3]);
  return !isNaN(new Date(raw).getTime());
}

/** Stricter than isValidIcsDateInput: an EMPTY date is not acceptable (the UI must not silently export "today"). */
export function isStrictIcsDate(input: string | undefined): boolean {
  return !!(input || '').trim() && isValidIcsDateInput(input);
}

export function parseIcsTime(input: string | undefined): { h: number; min: number } {
  return parseTimeParts(input); // shared parser: word-boundary am/pm, first time of a range, 12 AM/PM handled
}

export function buildIcsContent(input: IcsInput): string {
  const now = input.now ?? new Date();
  const title = (input.title || 'Reminder').trim() || 'Reminder';
  const note = (input.note || '').trim();
  const location = (input.location || '').trim();
  const recipient = (input.recipient || '').trim();

  const { y, m, d } = parseIcsDate(input.date, now);
  const { h, min } = parseIcsTime(input.time);

  // Floating local time; the +1h end is computed with real date arithmetic so it rolls
  // over month / year boundaries correctly (e.g. 31 Dec 23:30 -> 1 Jan 00:30).
  const fmtLocal = (dt: Date) =>
    `${pad(dt.getUTCFullYear(), 4)}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
  const start = new Date(Date.UTC(y, m - 1, d, h, min));
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const dtStamp = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const description = `${note}${recipient ? ` (For: ${recipient})` : ''} - DocuMind Reminder`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DocuMind Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:docmind-${now.getTime()}-${Math.floor(Math.random() * 100000)}@docmind.app`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${fmtLocal(start)}`,
    `DTEND:${fmtLocal(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function icsFilename(title?: string): string {
  const base = (title || 'Reminder').replace(/[^a-zA-Z0-9]/g, '_') || 'Reminder';
  return `${base}.ics`;
}
