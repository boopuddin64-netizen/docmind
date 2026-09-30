import { buildIcsContent, icsFilename, isStrictIcsDate } from './icsBuilder';
import { DEFAULT_LEAD_MINUTES, clampLeadMinutes } from './schedule';
import type { CalendarLinkInput } from './calendarLinks';
import { DEFAULT_PLATFORM, browserPlatform, launchAppWithFallback, planCalendarLaunch, type LaunchPlan, type PlatformInfo } from './calendarPlatform';

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
  /** Opens an https page in a NEW window / tab (or the OS in-app browser). Never used for same-origin files in an iOS standalone PWA. */
  openUrl: (url: string) => void;
  /** Detected platform. Omitted => DEFAULT_PLATFORM (plain web links only, no app schemes). */
  platform?: PlatformInfo;
  /** Absolute origin of the app (for share-by-link); omitted => relative URL. */
  origin?: string;
  /** Runs a launch plan (intent:// / app scheme with timed fallback / web). Omitted => the web fallback link is opened. */
  launch?: (plan: LaunchPlan) => void;
}

export function browserEnv(): IcsExportEnv {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const ua: string = nav.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const platform = browserPlatform();
  const clickLink = (url: string, newWindow: boolean) => {
    const link = document.createElement('a');
    link.href = url;
    if (newWindow) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const openUrl = (url: string) => {
    // NOTE: window.open(..., 'noopener') always returns null, so "null => navigate" would also navigate the app away
    // after a successful open. A programmatic <a target=_blank> click has no such ambiguity and is treated as a user gesture.
    try { clickLink(url, true); } catch { window.location.assign(url); }
  };
  return {
    isMobile,
    platform,
    origin: typeof location !== 'undefined' ? location.origin : undefined,
    online: nav.onLine !== false,
    openUrl,
    launch: (plan) => {
      if (plan.mode === 'web') return openUrl(plan.url);
      if (plan.mode === 'intent') {
        // Same-window navigation to intent://: Chrome opens the app, or itself goes to S.browser_fallback_url.
        try { clickLink(plan.url, false); } catch { openUrl(plan.fallbackUrl); }
        return;
      }
      // iOS app scheme: no "app missing" signal exists, so watch whether the page gets hidden (= the app opened).
      launchAppWithFallback(plan.url, plan.fallbackUrl, {
        fire: (u) => { try { clickLink(u, false); } catch { /* the timed fallback handles it */ } },
        fallback: openUrl,
        isHidden: () => document.visibilityState === 'hidden',
        subscribe: (onLeave) => {
          const vis = () => { if (document.visibilityState === 'hidden') onLeave(); };
          document.addEventListener('visibilitychange', vis);
          window.addEventListener('pagehide', onLeave);
          return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', onLeave); };
        },
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      });
    },
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

function icsInput(reminder: ExportableReminder) {
  return {
    title: reminder.eventTitle,
    note: reminder.shortNote,
    location: reminder.hospitalName,
    recipient: reminder.patientName,
    date: reminder.appointmentDate,
    time: reminder.appointmentTime,
    uid: reminder.id,
    alarmMinutes: alarmMinutesFor(reminder),
  };
}

export async function exportIcsCalendar(reminder: ExportableReminder, env: IcsExportEnv = browserEnv()): Promise<IcsExportResult> {
  // Refuse to export an invalid / missing date (it would silently become "today" in the calendar).
  if (!isStrictIcsDate(reminder.appointmentDate)) {
    return { ok: false, reason: 'invalid-date', message: 'Can not export: this reminder has no valid date. Edit the date first.' };
  }
  const content = buildIcsContent(icsInput(reminder));
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

  // Never point the iOS Home Screen app at the server .ics (same-origin => loads into the app's own web view => white screen).
  const iosStandalone = env.platform?.os === 'ios' && env.platform.standalone;
  if (env.online && !iosStandalone) {
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

export type CalendarTarget = 'share' | 'apple' | 'google' | 'outlook' | 'outlook365' | 'device' | 'ics';

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

function launchLink(env: IcsExportEnv, target: 'google' | 'outlook' | 'outlook365' | 'device', input: CalendarLinkInput, label: string): CalendarExportResult {
  if (!env.online) return { ok: false, reason: 'offline', message: `You are offline. Connect to the internet to open ${label}, or download the .ics file instead.` };
  try {
    const platform = env.platform ?? DEFAULT_PLATFORM;
    const plan = planCalendarLaunch(target, platform, input);
    if (env.launch) env.launch(plan);
    else env.openUrl(plan.fallbackUrl);
    const appFirst = plan.mode !== 'web';
    return { ok: true, target, method: 'link', message: appFirst ? `Opening ${label} app...` : `Opening ${label}...` };
  } catch {
    return { ok: false, reason: 'failed', message: `Could not open ${label}. Try "Download .ics file" instead.` };
  }
}

/**
 * Apple Calendar. The old implementation navigated to the https /api/download-ics link. Inside the iOS Home Screen PWA that link
 * is same-origin / in-scope, so iOS loads the text/calendar response INTO THE APP'S OWN WEB VIEW, which cannot render it: white
 * screen with no way back. Rule now: the standalone app is never pointed at the .ics URL.
 *   1. Web Share with the .ics File (share sheet -> "Add to Calendar")            [all iOS 15+ where canShare accepts it]
 *   2. iOS standalone: on-device file download (<a download>, no navigation), else share the https link
 *      iOS browser tab: open the server .ics in a NEW tab (Safari shows its native "Add to Calendar" preview)
 *   3. anything else: the plain file export chain
 * Every result keeps the app on screen.
 */
async function exportApple(reminder: ExportableReminder, env: IcsExportEnv): Promise<CalendarExportResult> {
  const platform = env.platform ?? DEFAULT_PLATFORM;
  const standalone = platform.os === 'ios' && platform.standalone;
  const target: CalendarTarget = 'apple';

  // 1. share sheet with the file
  if (canShareIcsFile(env)) {
    const r = await exportIcsCalendar(reminder, { ...env, isMobile: true, saveBlob: () => { throw new Error('share only'); }, openUrl: () => { throw new Error('share only'); } });
    if (r.ok === true) return { ok: true, target, method: r.method, message: 'In the share sheet, tap "Add to Calendar" (or Calendar), then Add.' };
    if (r.reason === 'cancelled' || r.reason === 'invalid-date') return r;
    // any other failure: try the next strategy
  }

  // 1b. Some iOS versions refuse text/calendar in canShare() but accept the same bytes typed as plain text (the .ics extension
  //     still identifies it to Calendar / Files). Only tried when the calendar type was refused.
  if (platform.os === 'ios' && env.shareFile && env.canShareFile && !canShareIcsFile(env) && isStrictIcsDate(reminder.appointmentDate)) {
    try {
      const plain = new File([buildIcsContent(icsInput(reminder))], icsFilename(reminder.eventTitle), { type: 'text/plain' });
      if (env.canShareFile(plain)) {
        await env.shareFile(plain, reminder.eventTitle || 'Reminder');
        return { ok: true, target, method: 'share', message: 'In the share sheet, tap "Add to Calendar" (or save to Files and open it).' };
      }
    } catch (e: any) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled', message: 'Export cancelled.' };
    }
  }

  if (!standalone && env.online) {
    // Safari tab: a NEW tab keeps this page alive. (Never navigates the current page.)
    try {
      env.openUrl(absolute(serverIcsUrl(reminder), env));
      return { ok: true, target, method: 'server', message: 'Opening the event in a new tab: tap "Add to Calendar" when it appears.' };
    } catch { /* fall through */ }
  }

  // 2/3. on-device file (no navigation), which keeps the app visible in the standalone PWA
  const r = await exportIcsCalendar(reminder, { ...env, isMobile: false, shareFile: undefined, canShareFile: undefined, openUrl: () => { throw new Error('never navigate'); } });
  if (r.ok === true) {
    return { ok: true, target, method: r.method, message: standalone
      ? `Calendar file "${r.filename}" saved. Open it from Files or Downloads and tap "Add to Calendar". Tip: Google Calendar or Outlook also work from this menu.`
      : r.message };
  }
  return r;
}

function absolute(path: string, env: IcsExportEnv): string {
  return env.origin && path.startsWith('/') ? env.origin + path : path;
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
      return launchLink(env, 'google', input, 'Google Calendar');
    case 'outlook':
      return launchLink(env, 'outlook', input, 'Outlook');
    case 'outlook365':
      return launchLink(env, 'outlook365', input, 'Outlook (work or school)');
    case 'device':
      return launchLink(env, 'device', input, 'your calendar');
    case 'apple':
      return exportApple(reminder, env);
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
