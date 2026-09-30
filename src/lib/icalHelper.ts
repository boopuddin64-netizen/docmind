import { buildIcsContent, icsFilename, isStrictIcsDate } from './icsBuilder';
import { DEFAULT_LEAD_MINUTES, clampLeadMinutes } from './schedule';

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
      const w = window.open(url, '_blank', 'noopener');
      if (!w) window.location.assign(url);
    },
  };
}

export function serverIcsUrl(reminder: ExportableReminder): string {
  const p = new URLSearchParams({
    title: reminder.eventTitle || 'Reminder',
    note: reminder.shortNote || '',
    location: reminder.hospitalName || '',
    recipient: reminder.patientName || '',
    date: reminder.appointmentDate || '',
    time: reminder.appointmentTime || '',
  });
  return `/api/download-ics?${p.toString()}`;
}

export async function exportIcsCalendar(reminder: ExportableReminder, env: IcsExportEnv = browserEnv()): Promise<IcsExportResult> {
  // Refuse to export an invalid / missing date (it would silently become "today" in the calendar).
  if (!isStrictIcsDate(reminder.appointmentDate)) {
    return { ok: false, reason: 'invalid-date', message: 'Can not export: this reminder has no valid date. Edit the date first.' };
  }
  const lead = reminder.notificationSchedule?.leadMinutes;
  const content = buildIcsContent({
    title: reminder.eventTitle,
    note: reminder.shortNote,
    location: reminder.hospitalName,
    recipient: reminder.patientName,
    date: reminder.appointmentDate,
    time: reminder.appointmentTime,
    uid: reminder.id,
    alarmMinutes: clampLeadMinutes(lead === undefined ? DEFAULT_LEAD_MINUTES : lead),
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
