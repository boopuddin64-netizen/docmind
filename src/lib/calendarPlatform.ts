/**
 * Platform detection + "open the calendar APP first, web page second" planning. DOM-free and unit-tested.
 *
 *  Android (Chrome / WebAPK / TWA): intent:// URLs. The browser opens the installed app, or itself navigates to
 *                                   S.browser_fallback_url when the app is missing.
 *  iOS (Safari tab or Home Screen PWA): custom app schemes (com.google.calendar://, ms-outlook://). iOS gives no "app missing"
 *                                   error, so we watch for the page being hidden (app opened); if it is still visible after
 *                                   APP_LAUNCH_TIMEOUT_MS we open the web link.
 *  Everything else (desktop, Firefox Android): the web link.
 */

import {
  buildAndroidInsertIntent, buildGoogleCalendarAndroidIntent, buildGoogleCalendarIosUrl, buildGoogleCalendarUrl,
  buildOutlookAndroidIntent, buildOutlookAppUrl, buildOutlookLiveUrl, buildOutlookOfficeUrl, type CalendarLinkInput,
} from './calendarLinks';

/** After firing an app scheme, the web fallback opens if the page is still visible after this long. */
export const APP_LAUNCH_TIMEOUT_MS = 1500;

export interface PlatformInfo {
  os: 'ios' | 'android' | 'other';
  /** Installed PWA (iOS `navigator.standalone`, `display-mode: standalone`, or an Android TWA). */
  standalone: boolean;
  /** Can this browser act on intent:// URLs? (Chromium yes; Firefox for Android no.) */
  intentCapable: boolean;
}

export const DEFAULT_PLATFORM: PlatformInfo = { os: 'other', standalone: false, intentCapable: false };

export interface PlatformSignals {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  /** iOS Safari only: navigator.standalone */
  navigatorStandalone?: boolean;
  /** matchMedia('(display-mode: standalone)').matches */
  displayModeStandalone?: boolean;
  referrer?: string;
}

export function detectPlatform(s: PlatformSignals): PlatformInfo {
  const ua = s.userAgent || '';
  // iPadOS 13+ reports a Mac user agent: tell it apart by touch support.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (s.platform === 'MacIntel' && (s.maxTouchPoints ?? 0) > 1);
  const android = !ios && /Android/i.test(ua);
  const standalone = s.navigatorStandalone === true || s.displayModeStandalone === true || (s.referrer || '').startsWith('android-app://');
  return {
    os: ios ? 'ios' : android ? 'android' : 'other',
    standalone,
    intentCapable: android && !/Firefox\/|FxiOS/i.test(ua),
  };
}

export function browserPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') return DEFAULT_PLATFORM;
  const nav: any = navigator;
  let display = false;
  try { display = typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches; } catch { /* ignore */ }
  return detectPlatform({
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    navigatorStandalone: nav.standalone,
    displayModeStandalone: display,
    referrer: typeof document !== 'undefined' ? document.referrer : undefined,
  });
}

export type LaunchTarget = 'google' | 'outlook' | 'outlook365' | 'device';
export interface LaunchPlan {
  /** intent: same-window navigation to an intent:// URL (browser handles fallback). scheme: fire + timed fallback. web: plain link. */
  mode: 'intent' | 'scheme' | 'web';
  url: string;
  /** Always a https web link. */
  fallbackUrl: string;
}

export function planCalendarLaunch(target: LaunchTarget, platform: PlatformInfo, input: CalendarLinkInput): LaunchPlan {
  const androidIntent = platform.os === 'android' && platform.intentCapable;
  const ios = platform.os === 'ios';
  switch (target) {
    case 'google': {
      const web = buildGoogleCalendarUrl(input);
      if (androidIntent) return { mode: 'intent', url: buildGoogleCalendarAndroidIntent(input), fallbackUrl: web };
      if (ios) return { mode: 'scheme', url: buildGoogleCalendarIosUrl(input), fallbackUrl: web };
      return { mode: 'web', url: web, fallbackUrl: web };
    }
    case 'outlook':
    case 'outlook365': {
      const office = target === 'outlook365';
      const web = office ? buildOutlookOfficeUrl(input) : buildOutlookLiveUrl(input);
      if (androidIntent) return { mode: 'intent', url: buildOutlookAndroidIntent(input, office), fallbackUrl: web };
      if (ios) return { mode: 'scheme', url: buildOutlookAppUrl(input), fallbackUrl: web };
      return { mode: 'web', url: web, fallbackUrl: web };
    }
    case 'device':
    default: {
      const web = buildGoogleCalendarUrl(input);
      if (androidIntent) return { mode: 'intent', url: buildAndroidInsertIntent(input, web), fallbackUrl: web };
      return { mode: 'web', url: web, fallbackUrl: web };
    }
  }
}

export interface LaunchDeps {
  fire: (url: string) => void;
  fallback: (url: string) => void;
  isHidden: () => boolean;
  /** Calls `onLeave` when the page is hidden / pagehide (= an app took over). Returns an unsubscribe. */
  subscribe: (onLeave: () => void) => () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}

/** Fires an app URL; opens the web fallback only if the app did not take over (page still visible after the timeout). */
export function launchAppWithFallback(url: string, fallbackUrl: string, deps: LaunchDeps, timeoutMs = APP_LAUNCH_TIMEOUT_MS): { cancel: () => void } {
  let done = false;
  let timer: unknown;
  let unsubscribe: () => void = () => {};
  const finish = () => { done = true; deps.clearTimer(timer); unsubscribe(); };
  unsubscribe = deps.subscribe(() => { if (!done) finish(); }); // the app opened: never open the web page on top of it
  deps.fire(url);
  if (!done) {
    timer = deps.setTimer(() => {
      if (done) return;
      finish();
      if (!deps.isHidden()) deps.fallback(fallbackUrl);
    }, timeoutMs);
  }
  return { cancel: () => { if (!done) finish(); } };
}
