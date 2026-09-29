/**
 * Framework-agnostic Web Push backend logic (validation, endpoints, dispatcher).
 * Wired into Express by backend/apiApp.ts, which is used both by server.ts (local / long-running host)
 * and by the Vercel serverless function api/index.ts.
 */
import crypto from 'node:crypto';
import webpush from 'web-push';
import {
  MAX_LEAD_MINUTES,
  clampLeadMinutes,
  describeEvent,
  eligibleEvents,
  type SyncedReminder,
} from '../src/lib/schedule.js';
import { SENT_TTL_SECONDS, type PushStore, type PushSubscriptionJSON } from './store.js';

export const MAX_REMINDERS_PER_SUBSCRIPTION = 500;
export const MAX_TITLE_LENGTH = 120;
export const MAX_ENDPOINT_LENGTH = 1024;

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  cronSecret: string;
  /** Do not include reminder titles in push payloads (privacy mode). */
  hideTitles: boolean;
  /** Events older than this are dropped instead of sent (protects against a burst of stale alerts after downtime). */
  maxLateMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): PushConfig {
  return {
    publicKey: (env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (env.VAPID_SUBJECT || '').trim(),
    cronSecret: (env.CRON_SECRET || '').trim(),
    hideTitles: /^(1|true|yes)$/i.test(env.PUSH_HIDE_TITLES || ''),
    maxLateMs: Math.max(1, Number(env.PUSH_MAX_LATE_MINUTES) || 360) * 60_000,
  };
}

export function isConfigured(c: PushConfig): boolean {
  return Boolean(c.publicKey && c.privateKey && /^(mailto:|https:\/\/)/.test(c.subject));
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const ok = (body: unknown = { success: true }): ApiResult => ({ status: 200, body });
const err = (status: number, error: string): ApiResult => ({ status, body: { success: false, error } });

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const subscriptionIdFor = (endpoint: string) => sha256(endpoint).slice(0, 32);

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Bearer token check for the cron/dispatch endpoint. Fails closed when CRON_SECRET is not configured. */
export function isCronAuthorized(authHeader: string | undefined, cfg: PushConfig): boolean {
  if (!cfg.cronSecret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  return Boolean(m && safeEqual(m[1].trim(), cfg.cronSecret));
}

// ───────────────────────── validation ─────────────────────────

export function validateSubscription(raw: any): PushSubscriptionJSON | null {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = raw.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' && !(process.env.PUSH_ALLOW_INSECURE_ENDPOINTS === '1' && url.protocol === 'http:')) return null;
  const p256dh = raw.keys?.p256dh;
  const auth = raw.keys?.auth;
  const b64url = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !b64url.test(p256dh) || !b64url.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth }, expirationTime: typeof raw.expirationTime === 'number' ? raw.expirationTime : null };
}

export function validateReminders(raw: unknown): SyncedReminder[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_REMINDERS_PER_SUBSCRIPTION) return null;
  const byId = new Map<string, SyncedReminder>(); // de-dupe by id, last one wins
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const { id, title, dueAt, leadMinutes, snoozedUntil } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 100) return null;
    if (typeof dueAt !== 'number' || !Number.isFinite(dueAt) || dueAt < 0 || dueAt > 4_102_444_800_000) return null;
    const lead = leadMinutes === undefined ? undefined : Number(leadMinutes);
    if (lead !== undefined && (!Number.isFinite(lead) || lead < 0 || lead > MAX_LEAD_MINUTES)) return null;
    const sn = snoozedUntil == null ? null : Number(snoozedUntil);
    if (sn !== null && !Number.isFinite(sn)) return null;
    byId.set(id, {
      id,
      title: (typeof title === 'string' ? title : 'Reminder').slice(0, MAX_TITLE_LENGTH),
      dueAt: Math.floor(dueAt),
      leadMinutes: clampLeadMinutes(lead),
      snoozedUntil: sn === null ? null : Math.floor(sn),
    });
  }
  return [...byId.values()];
}

// ───────────────────────── endpoints ─────────────────────────

export interface PushDeps {
  store: PushStore;
  config: PushConfig;
  /** Injectable for tests: performs the actual Web Push send. */
  sender?: PushSender;
  now?: () => number;
}

export type PushSender = (
  sub: PushSubscriptionJSON,
  payload: string,
  opts: { ttl: number; urgency: 'high' | 'normal' | 'low'; topic?: string },
) => Promise<void>;

let vapidKey = '';
export function createWebPushSender(cfg: PushConfig): PushSender {
  return async (sub, payload, opts) => {
    const k = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
    if (vapidKey !== k) {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      vapidKey = k;
    }
    await webpush.sendNotification(sub as webpush.PushSubscription, payload, { TTL: opts.ttl, urgency: opts.urgency, topic: opts.topic });
  };
}

export function getPublicKey(deps: PushDeps): ApiResult {
  if (!isConfigured(deps.config)) return err(503, 'Web Push is not configured on the server (VAPID keys missing).');
  return ok({ success: true, publicKey: deps.config.publicKey });
}

export async function subscribe(deps: PushDeps, body: any): Promise<ApiResult> {
  if (!isConfigured(deps.config)) return err(503, 'Web Push is not configured on the server.');
  const sub = validateSubscription(body?.subscription);
  if (!sub) return err(400, 'Invalid push subscription.');
  const id = subscriptionIdFor(sub.endpoint);
  const token = crypto.randomBytes(32).toString('base64url');
  await deps.store.putSubscription({
    id,
    tokenHash: sha256(token),
    subscription: sub,
    createdAt: (deps.now ?? Date.now)(),
    userAgent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 200) : undefined,
  });
  return ok({ success: true, subscriptionId: id, token });
}

async function authenticate(deps: PushDeps, subscriptionId: unknown, authHeader: string | undefined) {
  if (typeof subscriptionId !== 'string' || !/^[a-f0-9]{32}$/.test(subscriptionId)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  if (!m) return null;
  const stored = await deps.store.getSubscription(subscriptionId);
  if (!stored || !safeEqual(sha256(m[1].trim()), stored.tokenHash)) return null;
  return stored;
}

export async function unsubscribe(deps: PushDeps, body: any, authHeader: string | undefined): Promise<ApiResult> {
  const stored = await authenticate(deps, body?.subscriptionId, authHeader);
  if (!stored) return err(401, 'Unknown subscription or bad token.');
  await deps.store.removeSubscription(stored.id);
  return ok();
}

export async function syncReminders(deps: PushDeps, body: any, authHeader: string | undefined): Promise<ApiResult> {
  const stored = await authenticate(deps, body?.subscriptionId, authHeader);
  if (!stored) return err(401, 'Unknown subscription or bad token.');
  const reminders = validateReminders(body?.reminders);
  if (!reminders) return err(400, `Invalid reminders (array of at most ${MAX_REMINDERS_PER_SUBSCRIPTION}).`);
  const tz = Number(body?.tzOffsetMinutes);
  await deps.store.putReminders(stored.id, {
    reminders,
    tzOffsetMinutes: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0,
    updatedAt: (deps.now ?? Date.now)(),
  });
  return ok({ success: true, count: reminders.length });
}

// ───────────────────────── dispatcher ─────────────────────────

export interface DispatchSummary {
  success: true;
  subscriptions: number;
  sent: number;
  skippedDuplicates: number;
  failed: number;
  pruned: number;
  dispatchedAt: string;
}

export interface PushPayload {
  v: 1;
  /** notification tag == reminder id, so a heads-up is replaced by the "due" notification instead of stacking */
  tag: string;
  reminderId: string;
  /** de-dupe key of the event, so the page does not show the same alert again when reopened */
  eventKey: string;
  title: string;
  body: string;
  dueAt: number;
  url: string;
}

export function buildPayload(ev: ReturnType<typeof eligibleEvents>[number], now: number, cfg: PushConfig): PushPayload {
  const d = describeEvent(ev, now);
  return {
    v: 1,
    tag: ev.id,
    reminderId: ev.id,
    eventKey: ev.key,
    title: cfg.hideTitles ? 'DocuMind reminder' : d.title,
    body: cfg.hideTitles ? 'You have a reminder due. Open DocuMind for details.' : d.body,
    dueAt: ev.reminder.dueAt,
    url: '/',
  };
}

export function isGone(e: any): boolean {
  return e?.statusCode === 404 || e?.statusCode === 410;
}

export async function dispatchDue(deps: PushDeps): Promise<DispatchSummary> {
  const { store, config } = deps;
  const now = (deps.now ?? Date.now)();
  const sender = deps.sender ?? createWebPushSender(config);
  const summary: DispatchSummary = { success: true, subscriptions: 0, sent: 0, skippedDuplicates: 0, failed: 0, pruned: 0, dispatchedAt: new Date(now).toISOString() };

  const ids = await store.listSubscriptionIds();
  summary.subscriptions = ids.length;

  const handleOne = async (id: string) => {
    const [sub, data] = await Promise.all([store.getSubscription(id), store.getReminders(id)]);
    if (!sub) return;
    if (!data) return;
    const events = eligibleEvents(data.reminders, now, { maxLateMs: config.maxLateMs });
    for (const ev of events) {
      const claimKey = `${id}|${ev.key}`;
      if (!(await store.claim(claimKey, SENT_TTL_SECONDS))) {
        summary.skippedDuplicates++;
        continue;
      }
      try {
        await sender(sub.subscription, JSON.stringify(buildPayload(ev, now, config)), {
          ttl: 6 * 3600,
          urgency: 'high',
          topic: ev.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        });
        summary.sent++;
      } catch (e: any) {
        if (isGone(e)) {
          await store.removeSubscription(id);
          summary.pruned++;
          return;
        }
        // Transient failure (network / 5xx / 429): un-claim so the next run retries.
        await store.release(claimKey);
        summary.failed++;
        console.warn(`[push] send failed for ${id} (${e?.statusCode ?? e?.message ?? 'error'})`);
      }
    }
  };

  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map((id) => handleOne(id).catch((e) => {
      summary.failed++;
      console.warn('[push] dispatch error:', e?.message);
    })));
  }
  return summary;
}
