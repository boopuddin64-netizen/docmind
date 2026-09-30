import React from 'react';
import { SNOOZE_OPTIONS } from '../lib/snooze';

interface SnoozeOptionsProps {
  onPick: (minutes: number) => void;
  /** Id prefix so every button has a stable, unique DOM id. */
  idPrefix: string;
  compact?: boolean;
}

/** The six snooze choices (5 min, 10 min, 30 min, 1 hour, 4 hours, 24 hours) as a button grid. */
export const SnoozeOptions: React.FC<SnoozeOptionsProps> = ({ onPick, idPrefix, compact = false }) => (
  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Snooze for">
    {SNOOZE_OPTIONS.map((o) => (
      <button
        key={o.minutes}
        type="button"
        id={`${idPrefix}-${o.minutes}`}
        onClick={() => onPick(o.minutes)}
        className={`${compact ? 'py-1 px-1.5 text-[10px]' : 'py-1.5 px-2 text-xs'} bg-white dark:bg-[#0c1e2e] border border-slate-200 dark:border-sky-900/50 hover:bg-slate-100 dark:hover:bg-sky-900/30 font-bold rounded-xl text-[#3f4945] dark:text-sky-200 text-center transition-colors`}
      >
        {o.short}
      </button>
    ))}
  </div>
);
