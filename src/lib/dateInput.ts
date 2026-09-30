/**
 * Strict-but-friendly date / time parsing shared by the forms (browser) and the scan endpoint (server).
 * Pure: no DOM, no Node APIs.
 */
import { parseDateParts } from './schedule.js';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function realDate(y: number, m: number, d: number): boolean {
  if (!(y >= 1970 && y <= 2200) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parses one calendar date. Accepts DD/MM/YYYY (also - .), YYYY-MM-DD (optionally followed by a time),
 * and month-name forms: "Nov 15, 2026", "15 November 2026", "November 15th 2026", "Sat, 15 Nov 2026".
 * Returns null for anything else and for impossible dates ("99/99/9999", "31/02/2026", "banana").
 */
export function parseFlexibleDate(input: unknown): { y: number; m: number; d: number } | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 60) return null;
  s = s.replace(/^(\d{4}-\d{1,2}-\d{1,2})[T ].*$/, '$1'); // ISO date-time
  const numeric = parseDateParts(s);
  if (numeric) return numeric;

  const clean = s.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, '').replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  // "Nov 15, 2026" / "November 15 2026"
  let m = clean.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo && realDate(+m[3], mo, +m[2]) ? { y: +m[3], m: mo, d: +m[2] } : null;
  }
  // "15 Nov 2026" / "15 November, 2026"
  m = clean.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo && realDate(+m[3], mo, +m[1]) ? { y: +m[3], m: mo, d: +m[1] } : null;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DD/MM/YYYY, or '' when the input is not a real date. */
export function toDdMmYyyy(input: unknown): string {
  const p = parseFlexibleDate(input);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : '';
}

/** `error` is set when `ok` is false; `value` is the normalised value when `ok` is true. */
export interface FieldCheck { ok: boolean; value: string; error?: string }

export function validateDateField(input: string, opts: { required?: boolean } = {}): FieldCheck {
  const raw = (input || '').trim();
  if (!raw) return opts.required === false ? { ok: true, value: '' } : { ok: false, value: '', error: 'Enter a date (DD/MM/YYYY).' };
  const v = toDdMmYyyy(raw);
  return v ? { ok: true, value: v } : { ok: false, value: '', error: 'Enter a valid date like 15/11/2026.' };
}

/** Accepts "10:00 AM", "9am", "7:05 pm", "14:30", "0:15". Returns "hh:mm AM/PM". Empty => default 08:00 AM. */
export function validateTimeField(input: string): FieldCheck {
  const raw = (input || '').trim();
  if (!raw) return { ok: true, value: '08:00 AM' };
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([aApP])\.?[mM]\.?$|^(\d{1,2}):(\d{2})$/);
  if (!m) return { ok: false, value: '', error: 'Enter a valid time like 10:00 AM or 14:30.' };
  let h: number;
  let min: number;
  if (m[4] !== undefined) {
    h = +m[4]; min = +m[5];
    if (h > 23 || min > 59) return { ok: false, value: '', error: 'Enter a valid time like 10:00 AM or 14:30.' };
  } else {
    h = +m[1]; min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return { ok: false, value: '', error: 'Enter a valid time like 10:00 AM or 14:30.' };
    const pm = m[3].toLowerCase() === 'p';
    h = (h % 12) + (pm ? 12 : 0);
  }
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { ok: true, value: `${pad(h12)}:${pad(min)} ${suffix}` };
}
