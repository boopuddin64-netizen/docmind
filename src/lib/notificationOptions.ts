/**
 * Options for notifications shown by the PAGE (public/sw.js builds the same set for pushes; tests keep them in step).
 * Everything that makes a notification pop up as a heads-up banner on a phone lives here: audible (silent:false),
 * vibration, sticky until dismissed, a per-reminder tag with renotify so a repeat re-alerts instead of updating silently.
 */
export const VIBRATE_PATTERN: readonly number[] = Object.freeze([300, 150, 300, 150, 600]);
export const NOTIFICATION_ICON = '/icon-192.png';
/** Monochrome (white on transparent) status-bar badge; Android masks coloured badges into a plain blob. */
export const NOTIFICATION_BADGE = '/badge-96.png';

export interface LoudOptionsInput {
  body: string;
  tag: string;
  reminderId?: string;
  icon?: string;
  now?: number;
}

export function loudNotificationOptions(i: LoudOptionsInput) {
  return {
    body: i.body,
    icon: i.icon || NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    tag: i.tag,
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [...VIBRATE_PATTERN],
    timestamp: i.now ?? Date.now(),
    data: { reminderId: i.reminderId || '', url: '/' },
  };
}
