import { Reminder } from '../types';

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
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

/**
 * Parses date string in DD/MM/YYYY into JS Date object
 */
function parseDDMMYYYY(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\.-]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      return new Date(year, month, day);
    }
  }
  return null;
}

/**
 * Scans active reminders and computes pending alerts
 */
export function checkUpcomingAlerts(reminders: Reminder[]): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const item of reminders) {
    if (item.isCompleted) continue;

    // Check if snoozed
    if (item.notificationSchedule?.snoozedUntil) {
      const snoozedDate = new Date(item.notificationSchedule.snoozedUntil);
      if (snoozedDate > new Date()) {
        continue; // Skip snoozed alerts
      }
    }

    const dueDate = parseDDMMYYYY(item.appointmentDate);
    if (!dueDate) continue;

    dueDate.setHours(0, 0, 0, 0);
    const diffTime = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
 * Dispatches a native browser notification or audio alert chime
 */
export function dispatchNativeNotification(title: string, body: string, iconUrl?: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: iconUrl || '/docmind_app_icon.jpg',
        badge: '/icon-192.jpg',
        tag: 'docmind-alert',
      });
    } catch (e) {
      console.warn('Native notification spawn failed:', e);
    }
  }
}
