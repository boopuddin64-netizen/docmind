import React, { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Download, Mail, Share2, Smartphone, X, CalendarDays, Building2 } from 'lucide-react';
import { useEscapeKey } from '../lib/useEscapeKey';
import { canShareIcsFile, exportToCalendar, type CalendarTarget, type ExportableReminder } from '../lib/icalHelper';
import { deviceTimeZone } from '../lib/calendarLinks';
import { DEFAULT_PLATFORM, browserPlatform } from '../lib/calendarPlatform';

interface CalendarExportSheetProps {
  /** Reminder to export; null = closed. */
  reminder: ExportableReminder | null;
  onClose: () => void;
  /** Success AND failure feedback (never silent). */
  onShowToast?: (message: string) => void;
}

interface Option {
  target: CalendarTarget;
  label: string;
  hint: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: Option[] = [
  { target: 'share', label: 'Share / open in calendar app', hint: 'Send the event to any calendar app installed on your phone', Icon: Share2 },
  { target: 'device', label: 'Calendar app on this phone', hint: 'Opens your phone\'s calendar with the event filled in', Icon: CalendarPlus },
  { target: 'apple', label: 'Apple Calendar', hint: 'iPhone: choose "Add to Calendar" in the share sheet', Icon: Smartphone },
  { target: 'google', label: 'Google Calendar', hint: 'Opens the Google Calendar app if installed, otherwise the website', Icon: CalendarDays },
  { target: 'outlook', label: 'Outlook', hint: 'Opens the Outlook app if installed, otherwise the website', Icon: Mail },
  { target: 'outlook365', label: 'Outlook (work or school)', hint: 'Outlook app or Microsoft 365 website', Icon: Building2 },
  { target: 'ics', label: 'Download .ics file', hint: 'Works with every calendar app', Icon: Download },
];

/**
 * Bottom sheet (centered dialog on wide screens) that lets the user pick where the reminder goes.
 * Accessible: role=dialog + aria-modal, labelled, focus moved in and restored, Escape / backdrop / close button, Tab trapped.
 */
export const CalendarExportSheet: React.FC<CalendarExportSheetProps> = ({ reminder, onClose, onShowToast }) => {
  const open = reminder !== null;
  const [busy, setBusy] = useState<CalendarTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const canShare = open ? canShareIcsFile() : false;
  const platform = open ? browserPlatform() : DEFAULT_PLATFORM;

  useEscapeKey(open, onClose);

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setError(null);
    const previous = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!reminder) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !sheetRef.current) return;
    const items = sheetRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    if (items.length === 0) return;
    const first: HTMLButtonElement = items[0];
    const last: HTMLButtonElement = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const choose = async (target: CalendarTarget) => {
    setError(null);
    setBusy(target);
    try {
      const r = await exportToCalendar(reminder, target, undefined, deviceTimeZone());
      if (r.ok === true) {
        onShowToast?.(r.message);
        onClose();
      } else if (r.reason === 'cancelled') {
        setBusy(null); // user dismissed the share sheet: stay open, no error
      } else {
        setError(r.message);
        onShowToast?.(r.message);
        setBusy(null);
      }
    } catch (e: any) {
      const msg = 'Could not add this event to your calendar. Try "Download .ics file" instead.';
      setError(msg);
      onShowToast?.(msg);
      setBusy(null);
    }
  };

  // 'device' (Android insert intent) only exists on Android; 'apple' is shown on iOS only (elsewhere .ics / Share cover it).
  const visible = OPTIONS.filter((o) =>
    o.target === 'share' ? canShare :
    o.target === 'device' ? platform.os === 'android' && platform.intentCapable :
    o.target === 'apple' ? platform.os === 'ios' || platform.os === 'other' :
    true);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="calendar-export-backdrop"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-export-title"
        aria-describedby="calendar-export-desc"
        onKeyDown={trapTab}
        className="w-full sm:max-w-sm bg-white dark:bg-[#0c1e2e] text-[#191c1d] dark:text-white rounded-t-3xl sm:rounded-3xl border border-transparent dark:border-sky-900/40 shadow-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#005faf] dark:text-sky-300">
              <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" /> <span id="calendar-export-title">Add to calendar</span>
            </div>
            <p id="calendar-export-desc" className="text-sm font-bold truncate mt-0.5">{reminder.eventTitle || 'Reminder'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close calendar options" className="p-2 -m-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-sky-900/40">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-2" role="list">
          {visible.map(({ target, label, hint, Icon }) => (
            <li key={target}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => choose(target)}
                id={`btn-calendar-${target}`}
                className="w-full min-h-[52px] flex items-center gap-3 text-left rounded-2xl border border-slate-200 dark:border-sky-900/50 bg-slate-50 dark:bg-[#0a1926] hover:bg-[#54a0fe]/10 dark:hover:bg-sky-900/30 px-3 py-2.5 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#005faf] dark:focus-visible:ring-sky-400"
              >
                <Icon className="w-5 h-5 shrink-0 text-[#005faf] dark:text-sky-300" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{busy === target ? 'Working...' : label}</span>
                  <span className="block text-[11px] text-[#707975] dark:text-sky-300/70">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error && <p role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        <p className="text-[10px] text-[#707975] dark:text-sky-300/60">
          The .ics, Share and Apple options include your reminder alert. Google and Outlook links use their own default reminder.
        </p>
      </div>
    </div>
  );
};
