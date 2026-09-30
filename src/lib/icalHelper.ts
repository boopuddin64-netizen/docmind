import { buildIcsContent, icsFilename, isStrictIcsDate } from './icsBuilder';
import { DEFAULT_LEAD_MINUTES, clampLeadMinutes } from './schedule';
import { buildGoogleCalendarUrl, buildOutlookLiveUrl, buildOutlookOfficeUrl, type CalendarLinkInput } from './calendarLinks';

/**
 * iCal (.ics) export, generated 100% on the device (works offline; the server is only a last-resort fallback).
 *
 * Strategy (first that works wins):
 *  1. Mobile (Android / iOS, incl. installed PWA / TWA): Web Share API with the .ics FILE. This is the only method that reliably
 *     hands the file to the Calendar app from a standalone PWA (data: URLs are blocked there and blob downloads are ignored by
 *     Android TWAs / custom tabs).
 *  2. Blob + <a download> click (desktop browsers, and mobile browsers without file sharing).
 *  3. Open the server URL /api/download-ics?... (needs network) if the blob download throws.
 */

export interface ExportableReminder {
  id?: string;
  eventTitle: string;
  shortNote?: string;
  hospitalName?: string;
  patientName?: string;
  appointmentDate?: string; // DD/MM/YYYY or YYYY-MM-DD
  appointmentTime?: string; // e.g. "08:00 AM" or "08:00"; empty => all-day
  notificationSchedule?: { leadMinutes?: number };
}

export type IcsExportResult =
  | { ok: true; method: 'share' | 'download' | 'server'; filename: string; message: string }
  | { ok: false; reason: 'invalid-date' | 'cancelled' | 'failed'; message: string };

/** Everything that touches the browser, injectable so the logic is unit-testable in Node. */
export interface IcsExportEnv {
  isMobile: boolean;
  online: boolean;
  canShareFile?: (file: File) => boolean;
  shareFile?: (file: File, title: string) => Promise<void>;
  saveBlob: (blob: Blob, filename: string) => void;
  openUrl: (url: string) => void;
}

export function browserEnv(): IcsExportEnv {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const ua: string = nav.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return {
    isMobile,
    online: nav.onLine !== false,
    canShareFile: typeof nav.share === 'function' && typeof nav.canShare === 'function' ? (f) => { try { return !!nav.canShare({ files: [f] }); } catch { return false; } } : undefined,
    shareFile: typeof nav.share === 'function' ? (file, title) => nav.share({ files: [file], title }) : undefined,
    saveBlob: (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    openUrl: (url) => {
      // NOTE: window.open(..., 'noopener') always returns null, so "null => navigate" would also navigate the app away
      // after a successful open. A programmatic <a target=_blank> click has no such ambiguity, is treated as a user
      // gesture, and lets Android hand calendar.google.com links to the installed Google Calendar app.
      try {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        window.location.assign(url);
      }
    },
  };
}

function alarmMinutesFor(reminder: ExportableReminder): number {
  const lead = reminder.notificationSchedule?.leadMinutes;
  return clampLeadMinutes(lead === undefined ? DEFAULT_LEAD_MINUTES : lead);
}

/** Server-built .ics (same shared builder as the on-device file, incl. reminder alert + stable UID). Content-Type: text/calendar. */
export function serverIcsUrl(reminder: ExportableReminder): string {
  const p = new URLSearchParams({
    title: reminder.eventTitle || 'Reminder',
    note: reminder.shortNote || '',
    location: reminder.hospitalName || '',
    recipient: reminder.patientName || '',
    date: reminder.appointmentDate || '',
    time: reminder.appointmentTime || '',
    alarm: String(alarmMinutesFor(reminder)),
  });
  if (reminder.id) p.set('uid', reminder.id);
  return `/api/download-ics?${p.toString()}`;
}

export function calendarLinkInput(reminder: ExportableReminder, timeZone?: string): CalendarLinkInput {
  return {
    title: reminder.eventTitle,
    note: reminder.shortNote,
    location: reminder.hospitalName,
    recipient: reminder.patientName,
    date: reminder.appointmentDate,
    time: reminder.appointmentTime,
    timeZone,
  };
}

export async function exportIcsCalendar(reminder: ExportableReminder, env: IcsExportEnv = browserEnv()): Promise<IcsExportResult> {
  // Refuse to export an invalid / missing date (it would silently become "today" in the calendar).
  if (!isStrictIcsDate(reminder.appointmentDate)) {
    return { ok: false, reason: 'invalid-date', message: 'Can not export: this reminder has no valid date. Edit the date first.' };
  }
  const content = buildIcsContent({
    title: reminder.eventTitle,
    note: reminder.shortNote,
    location: reminder.hospitalName,
    recipient: reminder.patientName,
    date: reminder.appointmentDate,
    time: reminder.appointmentTime,
    uid: reminder.id,
    alarmMinutes: alarmMinutesFor(reminder),
  });
  const filename = icsFilename(reminder.eventTitle);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });

  if (env.isMobile && env.shareFile) {
    try {
      const file = new File([content], filename, { type: 'text/calendar' });
      if (!env.canShareFile || env.canShareFile(file)) {
        await env.shareFile(file, reminder.eventTitle || 'Reminder');
        return { ok: true, method: 'share', filename, message: 'Calendar event ready: choose Calendar to add it.' };
      }
    } catch (e: any) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled', message: 'Export cancelled.' };
      // any other share failure: fall through to the download path
    }
  }

  try {
    env.saveBlob(blob, filename);
    return { ok: true, method: 'download', filename, message: `Calendar file "${filename}" downloaded. Open it to add the event.` };
  } catch {
    // fall through to the server URL
  }

  if (env.online) {
    try {
      env.openUrl(serverIcsUrl(reminder));
      return { ok: true, method: 'server', filename, message: 'Opening the calendar file...' };
    } catch {
      /* fall through */
    }
  }
  return { ok: false, reason: 'failed', message: 'Could not export the calendar file on this device. Try again or use a different browser.' };
}

/** Back-compat wrapper: resolves true when a file was handed to the user. */
export async function downloadIcsCalendar(reminder: ExportableReminder): Promise<boolean> {
  return (await exportIcsCalendar(reminder)).ok;
}

// ---------------------------------------------------------------------------------------------------------------------
// Export picker targets
// ---------------------------------------------------------------------------------------------------------------------

export type CalendarTarget = 'share' | 'apple' | 'google' | 'outlook' | 'outlook365' | 'ics';

export type CalendarExportResult =
  | { ok: true; target: CalendarTarget; method: 'share' | 'download' | 'server' | 'link'; message: string }
  | { ok: false; reason: 'invalid-date' | 'cancelled' | 'failed' | 'unsupported' | 'offline'; message: string };

/** Can this browser hand a .ics FILE to an installed app (Web Share Level 2)? Used to show / hide the Share option. */
export function canShareIcsFile(env: IcsExportEnv = browserEnv()): boolean {
  if (!env.shareFile) return false;
  if (!env.canShareFile) return false; // navigator.canShare is required: a bare navigator.share cannot take files everywhere
  try {
    return env.canShareFile(new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], 'event.ics', { type: 'text/calendar' }));
  } catch {
    return false;
  }
}

function openLink(env: IcsExportEnv, url: string, target: CalendarTarget, label: string): CalendarExportResult {
  if (!env.online) return { ok: false, reason: 'offline', message: `You are offline. Connect to the internet to open ${label}, or download the .ics file instead.` };
  try {
    env.openUrl(url);
    return { ok: true, target, method: 'link', message: `Opening ${label}...` };
  } catch {
    return { ok: false, reason: 'failed', message: `Could not open ${label}. Try "Download .ics file" instead.` };
  }
}

/**
 * Runs one entry of the export picker. Must be called straight from the tap handler (before any `await`) so that
 * window.open / navigation is not treated as a blocked popup.
 */
export async function exportToCalendar(
  reminder: ExportableReminder,
  target: CalendarTarget,
  env: IcsExportEnv = browserEnv(),
  timeZone?: string,
): Promise<CalendarExportResult> {
  if (!isStrictIcsDate(reminder.appointmentDate)) {
    return { ok: false, reason: 'invalid-date', message: 'Can not export: this reminder has no valid date. Edit the date first.' };
  }
  const input = calendarLinkInput(reminder, timeZone);
  switch (target) {
    case 'google':
      return openLink(env, buildGoogleCalendarUrl(input), 'google', 'Google Calendar');
    case 'outlook':
      return openLink(env, buildOutlookLiveUrl(input), 'outlook', 'Outlook');
    case 'outlook365':
      return openLink(env, buildOutlookOfficeUrl(input), 'outlook365', 'Outlook (work or school)');
    case 'apple': {
      // https link to the server-built .ics (Content-Type: text/calendar, inline). iOS Safari shows "Add to Calendar" for it.
      // webcal:// is deliberately NOT used: iOS treats it as a calendar SUBSCRIPTION (adds a whole subscribed calendar and
      // needs a feed that stays online), not a one-off event, and it would drop nothing extra we need.
      if (env.online) {
        const r = openLink(env, serverIcsUrl(reminder), 'apple', 'Apple Calendar');
        if (r.ok) return { ...r, message: 'Opening the event: tap "Add to Calendar" when it appears.' };
      }
      // offline / could not open: hand the on-device file over instead (share sheet -> Calendar, or download)
      const fallback = await exportIcsCalendar(reminder, env);
      return fallback.ok === false ? fallback : { ok: true, target, method: fallback.method, message: fallback.message };
    }
    case 'share': {
      if (!canShareIcsFile(env)) {
        return { ok: false, reason: 'unsupported', message: 'Sharing files is not supported in this browser. Choose another option or download the .ics file.' };
      }
      const r = await exportIcsCalendar(reminder, { ...env, isMobile: true }); // share path only; falls back to download inside
      return r.ok === false ? r : { ok: true, target, method: r.method, message: r.message };
    }
    case 'ics':
    default: {
      // Explicit download: never opens the share sheet.
      const r = await exportIcsCalendar(reminder, { ...env, isMobile: false, shareFile: undefined, canShareFile: undefined });
      return r.ok === false ? r : { ok: true, target, method: r.method, message: r.message };
    }
  }
}
