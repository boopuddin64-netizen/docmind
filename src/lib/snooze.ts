/**
 * Snooze choices. Exactly these six are offered everywhere (in-app popup, notification centre, reminder detail,
 * the closed-app notification's picker) and are the only durations the app accepts.
 */
export interface SnoozeOption {
  minutes: number;
  /** Full label for buttons ("30 minutes"). */
  label: string;
  /** Compact label ("30 min"). */
  short: string;
}

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = Object.freeze([
  { minutes: 5, label: '5 minutes', short: '5 min' },
  { minutes: 10, label: '10 minutes', short: '10 min' },
  { minutes: 30, label: '30 minutes', short: '30 min' },
  { minutes: 60, label: '1 hour', short: '1 hour' },
  { minutes: 240, label: '4 hours', short: '4 hours' },
  { minutes: 1440, label: '24 hours', short: '24 hours' },
]);

export function isSnoozeMinutes(v: unknown): v is number {
  return typeof v === 'number' && SNOOZE_OPTIONS.some((o) => o.minutes === v);
}

export function snoozeLabel(minutes: number): string {
  return SNOOZE_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutes`;
}

/** Epoch ms at which a snooze of `minutes` started at `now` ends. Returns null for a duration that is not one of the six options. */
export function snoozeUntilMs(now: number, minutes: number): number | null {
  return isSnoozeMinutes(minutes) ? now + minutes * 60_000 : null;
}

/** Minimal reminder shape the snooze helpers touch (keeps this module free of UI types). */
interface SnoozableReminder {
  id: string;
  notificationSchedule?: { snoozedUntil?: string | null; [k: string]: unknown };
}

/**
 * Returns a copy of `reminders` with `reminderId` snoozed for `minutes` (one of the six options), or null when the
 * duration is not allowed / the reminder does not exist. The new `snoozedUntil` is what gets synced to the push
 * dispatcher, so the closed-app alert comes back after the chosen delay.
 */
export function applySnooze<T extends SnoozableReminder>(reminders: T[], reminderId: string, minutes: number, now: number): T[] | null {
  const until = snoozeUntilMs(now, minutes);
  if (until === null || !reminders.some((r) => r.id === reminderId)) return null;
  return reminders.map((r) =>
    r.id === reminderId
      ? { ...r, notificationSchedule: { ...r.notificationSchedule, snoozedUntil: new Date(until).toISOString() } }
      : r,
  );
}
