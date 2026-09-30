/**
 * Pure (DOM-free) iCalendar builder shared by the browser helper (icalHelper.ts)
 * and the Express endpoint (backend/apiApp.ts) so the two can never drift apart.
 *
 * Output follows RFC 5545: CRLF line ends, lines folded at 75 octets, escaped TEXT values,
 * UID + DTSTAMP + DTSTART + SUMMARY, optional VALARM. A reminder WITHOUT a usable time becomes an
 * all-day event (DTSTART;VALUE=DATE), otherwise a floating local-time event of one hour.
 */

import { parseTimeOrNull, parseTimeParts } from './schedule.js';
import { parseFlexibleDate } from './dateInput.js';

export interface IcsInput {
  title?: string;
  note?: string;
  location?: string;
  recipient?: string;
  date?: string; // DD/MM/YYYY, YYYY-MM-DD, "15 Nov 2026" ... (see parseFlexibleDate)
  time?: string; // "08:00 AM", "14:30"; empty / unparseable => all-day event
  /** Minutes before the start for a VALARM (all-day events: fires at 09:00 on the day). Omit / 0 = no alarm. */
  alarmMinutes?: number;
  /** Stable id (e.g. the reminder id) so re-importing updates the event instead of duplicating it. */
  uid?: string;
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

/** Fold a content line at 75 octets (RFC 5545 3.1) without splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
  if (utf8Length(line) <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = utf8Length(ch);
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines start with one space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // surrogate pair
    else n += 3;
  }
  return n;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export function parseIcsDate(input: string | undefined, fallback: Date): { y: number; m: number; d: number } {
  const def = { y: fallback.getFullYear(), m: fallback.getMonth() + 1, d: fallback.getDate() };
  return parseFlexibleDate((input || '').trim()) ?? def;
}

/** true when the input is empty (today is used) or a real date; false for garbage or impossible dates (e.g. 31/02/2026). */
export function isValidIcsDateInput(input: string | undefined): boolean {
  const raw = (input || '').trim();
  if (!raw) return true;
  return parseFlexibleDate(raw) !== null;
}

/** Stricter than isValidIcsDateInput: an EMPTY date is not acceptable (the UI must not silently export "today"). */
export function isStrictIcsDate(input: string | undefined): boolean {
  return !!(input || '').trim() && isValidIcsDateInput(input);
}

export function parseIcsTime(input: string | undefined): { h: number; min: number } {
  return parseTimeParts(input); // shared parser: word-boundary am/pm, first time of a range, 12 AM/PM handled
}

const fmtDate = (dt: Date) => `${pad(dt.getUTCFullYear(), 4)}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
const fmtYmd = (t: { y: number; m: number; d: number }) => `${pad(t.y, 4)}${pad(t.m)}${pad(t.d)}`;

export interface LocalDateTime { y: number; m: number; d: number; h: number; min: number }

export interface ResolvedEventWindow {
  allDay: boolean;
  /** All-day: h/min are 0. */
  start: LocalDateTime;
  /** Timed: start + 1 hour (wall clock). All-day: the EXCLUSIVE next day at 00:00 (same as DTEND;VALUE=DATE). */
  end: LocalDateTime;
}

const HOUR_MS = 60 * 60 * 1000;

function fromUtcFields(dt: Date): LocalDateTime {
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), min: dt.getUTCMinutes() };
}

/**
 * Single source of truth for WHEN an event happens, used by the .ics builder AND the Google / Outlook deep links
 * so all of them always agree (same parser, same all-day rule, same 1 hour default duration).
 * Date arithmetic is done in UTC so the end rolls over month / year boundaries (31 Dec 23:30 -> 1 Jan 00:30).
 */
export function resolveEventWindow(dateInput: string | undefined, timeInput: string | undefined, fallbackNow: Date = new Date()): ResolvedEventWindow {
  const { y, m, d } = parseIcsDate(dateInput, fallbackNow);
  const time = parseTimeOrNull(timeInput);
  if (time === null) {
    const start = new Date(Date.UTC(y, m - 1, d));
    return { allDay: true, start: fromUtcFields(start), end: fromUtcFields(new Date(start.getTime() + 24 * HOUR_MS)) };
  }
  const start = new Date(Date.UTC(y, m - 1, d, time.h, time.min));
  return { allDay: false, start: fromUtcFields(start), end: fromUtcFields(new Date(start.getTime() + HOUR_MS)) };
}

/** Human description shared by every export target. */
export function buildEventDescription(note?: string, recipient?: string): string {
  const n = (note || '').trim();
  const r = (recipient || '').trim();
  return [n, r ? `(For: ${r})` : '', '- DocuMind Reminder'].filter(Boolean).join(' ');
}

export function buildIcsContent(input: IcsInput): string {
  const now = input.now ?? new Date();
  const title = (input.title || 'Reminder').trim() || 'Reminder';
  const note = (input.note || '').trim();
  const location = (input.location || '').trim();
  const recipient = (input.recipient || '').trim();

  const win = resolveEventWindow(input.date, input.time, now);
  const allDay = win.allDay;

  const dtStamp = `${fmtDate(now)}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const description = buildEventDescription(note, recipient);
  const safeUid = (input.uid || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  const uid = safeUid ? `docmind-${safeUid}@docmind.app` : `docmind-${now.getTime()}-${Math.floor(Math.random() * 100000)}@docmind.app`;

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DocuMind Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dtStamp}`];

  // Date arithmetic is done in UTC so the end rolls over month / year boundaries correctly
  // (31 Dec 23:30 -> 1 Jan 00:30); the values are written as floating local times (no Z).
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fmtYmd(win.start)}`, `DTEND;VALUE=DATE:${fmtYmd(win.end)}`); // DTEND is exclusive for all-day events
  } else {
    lines.push(`DTSTART:${fmtYmd(win.start)}T${pad(win.start.h)}${pad(win.start.min)}00`, `DTEND:${fmtYmd(win.end)}T${pad(win.end.h)}${pad(win.end.min)}00`);
  }
  lines.push(`SUMMARY:${escapeIcsText(title)}`, `DESCRIPTION:${escapeIcsText(description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');

  const alarm = Math.floor(Number(input.alarmMinutes));
  if (Number.isFinite(alarm) && alarm > 0 && alarm <= 7 * 24 * 60) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(title)}`,
      allDay ? 'TRIGGER;RELATED=START:PT9H' : `TRIGGER:-PT${alarm}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function icsFilename(title?: string): string {
  const base = (title || 'Reminder').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Reminder';
  return `${base}.ics`;
}
