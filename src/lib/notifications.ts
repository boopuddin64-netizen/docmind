import { Reminder } from '../types';
import { calendarDaysUntil, parseDateParts } from './schedule';
import { loudNotificationOptions } from './notificationOptions';

export interface PendingAlert {
  reminderId: string;
  title: string;
  issuer: string;
  dueDate: string;
  dueTime: string;
  daysRemaining: number;
  severity: 'urgent' | 'warning' | 'info';
  message: string;
}

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function getPermissionState(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PermissionState;
}

/**
 * Requests native web browser notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Web notifications are not supported in this browser.');
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      // Let the app react (e.g. subscribe to Web Push) no matter which button triggered the prompt.
      window.dispatchEvent(new CustomEvent('docmind:permission-changed', { detail: permission }));
      return permission === 'granted';
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Scans active reminders and computes pending alerts
 */
export function checkUpcomingAlerts(reminders: Reminder[]): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  const now = new Date();

  for (const item of reminders) {
    if (item.isCompleted) continue;

    // Check if snoozed
    if (item.notificationSchedule?.snoozedUntil) {
      const snoozedDate = new Date(item.notificationSchedule.snoozedUntil);
      if (snoozedDate.getTime() > Date.now()) {
        continue; // Skip snoozed alerts
      }
    }

    const dueParts = parseDateParts(item.appointmentDate);
    if (!dueParts) continue;

    // Calendar-day difference (DST-safe; also understands both DD/MM/YYYY and YYYY-MM-DD).
    const daysRemaining = calendarDaysUntil(dueParts, now);

    if (daysRemaining < 0) {
      alerts.push({
        reminderId: item.id,
        title: item.eventTitle,
        issuer: item.hospitalName,
        dueDate: item.appointmentDate,
        dueTime: item.appointmentTime,
        daysRemaining,
        severity: 'urgent',
        message: `OVERDUE: ${item.eventTitle} from ${item.hospitalName} was due ${Math.abs(daysRemaining)} day(s) ago!`,
      });
    } else if (daysRemaining === 0) {
      alerts.push({
        reminderId: item.id,
        title: item.eventTitle,
        issuer: item.hospitalName,
        dueDate: item.appointmentDate,
        dueTime: item.appointmentTime,
        daysRemaining: 0,
        severity: 'urgent',
        message: `DUE TODAY: ${item.eventTitle} at ${item.appointmentTime}!`,
      });
    } else if (daysRemaining <= 3) {
      alerts.push({
        reminderId: item.id,
        title: item.eventTitle,
        issuer: item.hospitalName,
        dueDate: item.appointmentDate,
        dueTime: item.appointmentTime,
        daysRemaining,
        severity: 'warning',
        message: `Upcoming Deadline: ${item.eventTitle} is due in ${daysRemaining} day(s) (${item.appointmentDate}).`,
      });
    } else if (daysRemaining <= 7) {
      alerts.push({
        reminderId: item.id,
        title: item.eventTitle,
        issuer: item.hospitalName,
        dueDate: item.appointmentDate,
        dueTime: item.appointmentTime,
        daysRemaining,
        severity: 'info',
        message: `7-Day Notice: ${item.eventTitle} coming up on ${item.appointmentDate}.`,
      });
    }
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/**
 * Shows a system notification. Prefers ServiceWorkerRegistration.showNotification (the only API that works on
 * Android Chrome, where `new Notification()` throws) and falls back to the constructor.
 * Resolves true when a notification was handed to the browser.
 */
export async function dispatchNativeNotification(
  title: string,
  body: string,
  iconUrl?: string,
  tag: string = 'docmind-alert',
  reminderId?: string,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  // Same loud options as the service worker's push handler (sound, vibration, sticky, renotify, monochrome badge).
  const options = loudNotificationOptions({ body, tag, reminderId, icon: iconUrl }) as NotificationOptions;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch (e) {
    console.warn('Service worker notification failed, falling back:', e);
  }
  try {
    new Notification(title, options);
    return true;
  } catch (e) {
    console.warn('Native notification spawn failed:', e);
    return false;
  }
}

/** Closes the notification(s) with this tag that are still in the tray (used when the user snoozes/completes from inside the app). */
export async function closeNotificationsByTag(tag: string): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const list = (await reg?.getNotifications({ tag })) ?? [];
    for (const n of list) n.close();
  } catch {
    /* best effort */
  }
}
