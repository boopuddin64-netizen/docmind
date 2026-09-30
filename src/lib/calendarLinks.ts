/**
 * Pure (DOM-free) deep-link builders for "add to calendar" targets.
 *
 * Every builder derives WHEN from resolveEventWindow() in icsBuilder.ts (the same code that writes DTSTART / DTEND
 * into the .ics), so Google / Outlook / .ics always agree: same date+time parser, all-day when there is no usable time,
 * 1 hour default duration, month / year roll-over handled once.
 *
 * Limitation of the web deep links: neither Google nor Outlook accept a reminder (VALARM) parameter, so the event is
 * created with the calendar's own default reminder. Only the .ics / Share / Apple options carry the exact alert.
 */

import { buildEventDescription, resolveEventWindow, type LocalDateTime } from './icsBuilder';

export interface CalendarLinkInput {
  title?: string;
  note?: string;
  location?: string;
  recipient?: string;
  date?: string; // DD/MM/YYYY, YYYY-MM-DD, "15 Nov 2026" ...
  time?: string; // empty / unparseable => all-day
  /** IANA zone for Google's `ctz`. Defaults to the device zone (Intl). Omitted from the URL when unknown. */
  timeZone?: string;
  now?: Date;
}

export const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/render';
export const OUTLOOK_LIVE_URL = 'https://outlook.live.com/calendar/0/deeplink/compose';
/** Work / school (Microsoft 365) accounts. Microsoft reports that the "/0/" segment breaks office.com, so it is left out. */
export const OUTLOOK_OFFICE_URL = 'https://outlook.office.com/calendar/deeplink/compose';

// Outlook returns HTTP 500 above ~4100 characters for the whole URL; stay far below that (and below other URL limits).
const MAX_TITLE = 200;
const MAX_DETAILS = 1200;
const MAX_LOCATION = 200;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const ymd = (t: LocalDateTime) => `${pad(t.y, 4)}${pad(t.m)}${pad(t.d)}`;
const ymdDash = (t: LocalDateTime) => `${pad(t.y, 4)}-${pad(t.m)}-${pad(t.d)}`;
const hms = (t: LocalDateTime) => `${pad(t.h)}${pad(t.min)}00`;

function cut(s: string, max: number): string {
  const chars = Array.from(s); // do not split surrogate pairs (emoji)
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/** Query string with RFC 3986 percent-encoding (spaces as %20, & = # + ? all escaped; CR/LF become %0A). */
function query(params: [string, string | undefined][]): string {
  return params
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).replace(/\r\n|\r/g, '\n'))}`)
    .join('&');
}

export function deviceTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && /^[A-Za-z_]+(?:[/+-][A-Za-z0-9_+-]+)*$/.test(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

function common(input: CalendarLinkInput) {
  const title = cut((input.title || '').trim() || 'Reminder', MAX_TITLE);
  const details = cut(buildEventDescription(input.note, input.recipient), MAX_DETAILS);
  const location = cut((input.location || '').trim(), MAX_LOCATION);
  const win = resolveEventWindow(input.date, input.time, input.now);
  return { title, details, location, win };
}

/**
 * Google Calendar template link (opens the Google Calendar app on Android when installed, otherwise the web app).
 * Timed:   dates=YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS + ctz=<IANA zone>  (wall-clock time in the user's zone, +1h)
 * All-day: dates=YYYYMMDD/YYYYMMDD(+1 day, exclusive end)
 */
export function buildGoogleCalendarUrl(input: CalendarLinkInput): string {
  const { title, details, location, win } = common(input);
  const dates = win.allDay
    ? `${ymd(win.start)}/${ymd(win.end)}`
    : `${ymd(win.start)}T${hms(win.start)}/${ymd(win.end)}T${hms(win.end)}`;
  const q = query([['action', 'TEMPLATE'], ['text', title]]);
  // `dates` keeps its literal "/" (valid in a query string and what Google's own links use)
  const rest = query([['details', details], ['location', location], ['ctz', win.allDay ? undefined : input.timeZone ?? deviceTimeZone()]]);
  return `${GOOGLE_CALENDAR_URL}?${q}&dates=${dates}${rest ? `&${rest}` : ''}`;
}

/** The absolute instant of a wall-clock time in the DEVICE's timezone, as `YYYY-MM-DDTHH:MM:SSZ`. */
function localWallClockToUtcIso(t: LocalDateTime): string {
  const dt = new Date(t.y, t.m - 1, t.d, t.h, t.min, 0, 0);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00Z`;
}

function buildOutlookUrl(base: string, input: CalendarLinkInput): string {
  const { title, details, location, win } = common(input);
  // Timed: an explicit UTC instant computed from the device's local time (immune to the Outlook profile's own zone).
  // All-day: dates only + allday=true. enddt is the SAME day: it is correct whether Outlook treats the end date as
  // inclusive (documented examples) or exclusive (it never creates a zero-length all-day event).
  const startdt = win.allDay ? ymdDash(win.start) : localWallClockToUtcIso(win.start);
  const enddt = win.allDay ? ymdDash(win.start) : localWallClockToUtcIso(win.end);
  return `${base}?${query([
    ['path', '/calendar/action/compose'],
    ['rru', 'addevent'],
    ['subject', title],
    ['startdt', startdt],
    ['enddt', enddt],
    ['allday', win.allDay ? 'true' : undefined],
    ['body', details],
    ['location', location],
  ])}`;
}

/** Outlook.com / Hotmail / Live personal accounts (and the Outlook mobile app via the web link). */
export function buildOutlookLiveUrl(input: CalendarLinkInput): string {
  return buildOutlookUrl(OUTLOOK_LIVE_URL, input);
}

/** Microsoft 365 work / school accounts. */
export function buildOutlookOfficeUrl(input: CalendarLinkInput): string {
  return buildOutlookUrl(OUTLOOK_OFFICE_URL, input);
}
