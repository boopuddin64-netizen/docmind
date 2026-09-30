import React from 'react';
import { Clock, X } from 'lucide-react';
import { SnoozeOptions } from './SnoozeOptions';
import { useEscapeKey } from '../lib/useEscapeKey';

interface SnoozePickerModalProps {
  /** Title of the reminder being snoozed; null = closed. */
  title: string | null;
  onPick: (minutes: number) => void;
  onClose: () => void;
}

/** Small picker opened by the notification's "Snooze…" action (deep link /?snooze=<reminderId>). */
export const SnoozePickerModal: React.FC<SnoozePickerModalProps> = ({ title, onPick, onClose }) => {
  useEscapeKey(title !== null, onClose);
  if (title === null) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
      <div role="dialog" aria-modal="true" aria-label="Snooze reminder" className="bg-white dark:bg-[#0c1e2e] rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Clock className="w-3.5 h-3.5" /> Snooze for
            </div>
            <h2 className="text-sm font-bold text-[#191c1d] dark:text-white truncate mt-0.5">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close snooze picker" className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-sky-900/40">
            <X className="w-5 h-5" />
          </button>
        </div>
        <SnoozeOptions idPrefix="snooze-picker" onPick={onPick} />
        <p className="text-[11px] text-[#707975] dark:text-sky-300/70">You'll get the alert again after the time you pick, even if the app is closed.</p>
      </div>
    </div>
  );
};
