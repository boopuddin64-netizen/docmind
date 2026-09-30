/**
 * Framework-agnostic Web Push backend logic (validation, endpoints, dispatcher).
 * Wired into Express by backend/apiApp.ts, which is used both by server.ts (local / long-running host)
 * and by the Vercel serverless function api/index.ts.
 */
import crypto from 'node:crypto';
import webpush from 'web-push';
import {
  MAX_DUE_AT_MS,
  MAX_LEAD_MINUTES,
  clampLeadMinutes,
  describeEvent,
  eligibleEvents,
  type SyncedReminder,
} from '../src/lib/schedule.js';
import { MAX_DETAIL_CHARS, MAX_LINE_CHARS, categoryLabel, formatTestNotification, truncateText } from '../src/lib/notificationText.js';
import {
  CLAIM_LEASE_SECONDS,
  SENT_TTL_SECONDS,
  type PushStore,
  type PushSubscriptionJSON,
  type SubscriptionHealth,
} from './store.js';
import { isAllowedPushEndpoint, parseAllowedHosts, type EndpointPolicy } from './security.js';

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
  /** Extra push-service hosts allowed besides the built-in ones (env PUSH_ALLOWED_HOSTS). */
  allowedHosts: string[];
  /** TEST ONLY (env PUSH_ALLOW_LOCAL_TEST_ENDPOINTS=1): accept https://localhost|127.0.0.1 endpoints. Off by default, ignored on Vercel. */
  allowLocalTestEndpoints: boolean;
  /** Hard cap on stored subscriptions (env PUSH_MAX_SUBSCRIPTIONS). */
  maxSubscriptions: number;
  /** Per-send timeout. */
  sendTimeoutMs: number;
  /** After this much wall time the dispatcher stops starting new sends (rest is picked up by the next run). Must stay well under the 60s function limit. */
  dispatchBudgetMs: number;
  /** Parallel sends. */
  dispatchConcurrency: number;
  /** Length of the claim lease taken before a send. */
  claimLeaseSeconds: number;
}

/** Reminder pushes stay deliverable for this long if the phone is offline/dozing (a stale reminder is still useful for hours). */
export const REMINDER_PUSH_TTL_SECONDS = 6 * 3600;
/** A test push is worthless after a couple of minutes. */
export const TEST_PUSH_TTL_SECONDS = 120;
/** One test push per subscription per this many seconds (atomic via the store's claim, so it holds across serverless instances). */
export const TEST_PUSH_COOLDOWN_SECONDS = 20;

export const DEFAULT_SEND_TIMEOUT_MS = 8_000;
export const DEFAULT_DISPATCH_BUDGET_MS = 35_000; // + one 8s send in flight => ~43s worst case, under Vercel's 60s
export const MAX_DISPATCH_BUDGET_MS = 45_000;
export const DEFAULT_DISPATCH_CONCURRENCY = 10;
export const DEFAULT_MAX_SUBSCRIPTIONS = 1000;
/** Consecutive 400/401/403 responses before a subscription is pruned. */
export const PRUNE_AFTER_REJECTS = 3;
/** Consecutive failures of any other kind (timeouts, 5xx, 429, network) before pruning, and the minimum time span they must cover. */
export const PRUNE_AFTER_FAILURES = 10;
export const PRUNE_MIN_FAILURE_SPAN_MS = 24 * 3600_000;
/** A failure streak with no new failure for this long is forgotten. */
export const HEALTH_STALE_MS = 48 * 3600_000;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export function loadConfig(env: Record<string, string | undefined> = process.env): PushConfig {
  return {
    publicKey: (env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (env.VAPID_SUBJECT || '').trim(),
    cronSecret: (env.CRON_SECRET || '').trim(),
    hideTitles: /^(1|true|yes)$/i.test(env.PUSH_HIDE_TITLES || ''),
    maxLateMs: Math.max(1, Number(env.PUSH_MAX_LATE_MINUTES) || 360) * 60_000,
    allowedHosts: parseAllowedHosts(env.PUSH_ALLOWED_HOSTS),
    allowLocalTestEndpoints: env.PUSH_ALLOW_LOCAL_TEST_ENDPOINTS === '1' && !env.VERCEL,
    maxSubscriptions: Math.max(1, Math.floor(Number(env.PUSH_MAX_SUBSCRIPTIONS)) || DEFAULT_MAX_SUBSCRIPTIONS),
    sendTimeoutMs: Math.min(30_000, Math.max(500, Number(env.PUSH_SEND_TIMEOUT_MS) || DEFAULT_SEND_TIMEOUT_MS)),
    dispatchBudgetMs: Math.min(MAX_DISPATCH_BUDGET_MS, Math.max(1000, Number(env.PUSH_DISPATCH_BUDGET_MS) || DEFAULT_DISPATCH_BUDGET_MS)),
    dispatchConcurrency: Math.min(50, Math.max(1, Math.floor(Number(env.PUSH_DISPATCH_CONCURRENCY)) || DEFAULT_DISPATCH_CONCURRENCY)),
    claimLeaseSeconds: Math.min(600, Math.max(60, Number(env.PUSH_CLAIM_LEASE_SECONDS) || CLAIM_LEASE_SECONDS)),
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

export const endpointPolicyOf = (c: Pick<PushConfig, 'allowedHosts' | 'allowLocalTestEndpoints'>): EndpointPolicy => ({
  extraAllowedHosts: c.allowedHosts,
  allowLocalTestEndpoints: c.allowLocalTestEndpoints,
});

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
function decodedLength(v: unknown): number {
  if (typeof v !== 'string' || v.length > 200 || !B64URL.test(v)) return -1;
  return Buffer.from(v, 'base64url').length;
}

/** Endpoint must be an allow-listed push service; p256dh must be an uncompressed P-256 point (65 bytes), auth a 16-byte secret. */
export function validateSubscription(raw: any, policy: EndpointPolicy = {}): PushSubscriptionJSON | null {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = raw.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  if (!isAllowedPushEndpoint(endpoint, policy)) return null;
  const p256dh = raw.keys?.p256dh;
  const auth = raw.keys?.auth;
  if (decodedLength(p256dh) !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 0x04) return null;
  if (decodedLength(auth) !== 16) return null;
  return { endpoint, keys: { p256dh, auth }, expirationTime: typeof raw.expirationTime === 'number' ? raw.expirationTime : null };
}

export interface ValidatedReminders {
  reminders: SyncedReminder[];
  /** Items that were invalid and left out (the rest is still accepted). */
  skipped: number;
}

/**
 * Returns null only when the payload as a whole is unusable (not an array, or more than MAX_REMINDERS_PER_SUBSCRIPTION items).
 * Individual invalid items are SKIPPED and counted, so one bad reminder can never make the whole sync fail.
 */
export function validateReminders(raw: unknown): ValidatedReminders | null {
  if (!Array.isArray(raw) || raw.length > MAX_REMINDERS_PER_SUBSCRIPTION) return null;
  const byId = new Map<string, SyncedReminder>(); // de-dupe by id, last one wins
  let skipped = 0;
  for (const r of raw) {
    if (!r || typeof r !== 'object') { skipped++; continue; }
    const { id, title, dueAt, leadMinutes, snoozedUntil, category, detail, allDay } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 100) { skipped++; continue; }
    if (typeof dueAt !== 'number' || !Number.isFinite(dueAt) || dueAt < 0 || dueAt > MAX_DUE_AT_MS) { skipped++; continue; }
    const lead = leadMinutes === undefined ? undefined : Number(leadMinutes);
    if (lead !== undefined && (!Number.isFinite(lead) || lead < 0 || lead > MAX_LEAD_MINUTES)) { skipped++; continue; }
    const sn = snoozedUntil == null ? null : Number(snoozedUntil);
    if (sn !== null && !Number.isFinite(sn)) { skipped++; continue; }
    const item: SyncedReminder = {
      id,
      title: (typeof title === 'string' ? title : 'Reminder').slice(0, MAX_TITLE_LENGTH),
      dueAt: Math.floor(dueAt),
      leadMinutes: clampLeadMinutes(lead),
      snoozedUntil: sn === null ? null : Math.floor(sn),
    };
    // Optional display-only fields: sanitised and bounded here too (the client is not trusted).
    const cat = typeof category === 'string' ? categoryLabel(category) : '';
    if (cat) item.category = cat;
    if (typeof detail === 'string') {
      const d = detail.split(/\r\n|\r|\n/).map((l) => truncateText(l, MAX_LINE_CHARS)).filter(Boolean).slice(0, 2).join('\n').slice(0, MAX_DETAIL_CHARS);
      if (d) item.detail = d;
    }
    if (allDay === true) item.allDay = true;
    byId.set(id, item);
  }
  return { reminders: [...byId.values()], skipped };
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
  opts: { ttl: number; urgency: 'high' | 'normal' | 'low'; topic?: string; timeoutMs?: number },
) => Promise<void>;

let vapidKey = '';
export function createWebPushSender(cfg: PushConfig): PushSender {
  return async (sub, payload, opts) => {
    const k = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
    if (vapidKey !== k) {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      vapidKey = k;
    }
    await webpush.sendNotification(sub as webpush.PushSubscription, payload, { TTL: opts.ttl, urgency: opts.urgency, topic: opts.topic, timeout: opts.timeoutMs });
  };
}

export function getPublicKey(deps: PushDeps): ApiResult {
  if (!isConfigured(deps.config)) return err(503, 'Web Push is not configured on the server (VAPID keys missing).');
  return ok({ success: true, publicKey: deps.config.publicKey });
}

export async function subscribe(deps: PushDeps, body: any): Promise<ApiResult> {
  if (!isConfigured(deps.config)) return err(503, 'Web Push is not configured on the server.');
  const sub = validateSubscription(body?.subscription, endpointPolicyOf(deps.config));
  if (!sub) return err(400, 'Invalid push subscription.');
  const id = subscriptionIdFor(sub.endpoint);
  // Global cap (re-subscribing an existing endpoint is always allowed).
  if (!(await deps.store.getSubscription(id)) && (await deps.store.countSubscriptions()) >= deps.config.maxSubscriptions) {
    return err(503, 'Subscription limit reached on this server.');
  }
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
  const validated = validateReminders(body?.reminders);
  if (!validated) return err(400, `Invalid reminders (array of at most ${MAX_REMINDERS_PER_SUBSCRIPTION}).`);
  const { reminders, skipped } = validated;
  const tz = Number(body?.tzOffsetMinutes);
  await deps.store.putReminders(stored.id, {
    reminders,
    tzOffsetMinutes: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0,
    updatedAt: (deps.now ?? Date.now)(),
  });
  return ok({ success: true, count: reminders.length, skipped });
}

export interface TestPushPayload {
  v: 1;
  test: true;
  tag: string;
  reminderId: '';
  title: string;
  body: string;
  url: string;
}

export function buildTestPayload(now: number, tzOffsetMinutes?: number): TestPushPayload {
  const text = formatTestNotification(now, tzOffsetMinutes);
  return {
    v: 1,
    test: true,
    // Unique tag: every test is its own notification, never a silent replacement of the previous one.
    tag: `docmind-test-${now}`,
    reminderId: '',
    title: text.title,
    body: text.body,
    url: '/',
  };
}

/**
 * POST /api/push/test — sends ONE real push to the caller's own subscription (authenticated by subscription id + bearer
 * token, like sync/unsubscribe) so the user can check the pop-up behaviour. Rate limited per subscription (the per-IP
 * limiter in the route guards sits on top). Sent with the same high urgency as real reminders.
 */
export async function sendTestPush(deps: PushDeps, body: any, authHeader: string | undefined): Promise<ApiResult> {
  if (!isConfigured(deps.config)) return err(503, 'Web Push is not configured on the server.');
  const stored = await authenticate(deps, body?.subscriptionId, authHeader);
  if (!stored) return err(401, 'Unknown subscription or bad token.');
  if (!isAllowedPushEndpoint(stored.subscription.endpoint, endpointPolicyOf(deps.config))) {
    await deps.store.removeSubscription(stored.id);
    return err(410, 'This subscription is no longer valid. Turn notifications off and on again.');
  }
  const now = (deps.now ?? Date.now)();
  if (!(await deps.store.claim(`test|${stored.id}`, TEST_PUSH_COOLDOWN_SECONDS))) {
    return { status: 429, body: { success: false, error: `Please wait ${TEST_PUSH_COOLDOWN_SECONDS} seconds between test notifications.`, retryAfterSeconds: TEST_PUSH_COOLDOWN_SECONDS } };
  }
  const sender = deps.sender ?? createWebPushSender(deps.config);
  try {
    await withTimeout(
      sender(stored.subscription, JSON.stringify(buildTestPayload(now, (await deps.store.getReminders(stored.id))?.tzOffsetMinutes)), {
        ttl: TEST_PUSH_TTL_SECONDS,
        urgency: 'high',
        timeoutMs: deps.config.sendTimeoutMs,
      }),
      deps.config.sendTimeoutMs,
    );
  } catch (e: any) {
    if (isGone(e)) {
      await deps.store.removeSubscription(stored.id);
      return err(410, 'This device is no longer subscribed. Turn notifications off and on again.');
    }
    await deps.store.release(`test|${stored.id}`); // nothing was delivered: let the user retry right away
    if (e instanceof PushTimeoutError) return err(504, 'The push service did not answer in time. Try again.');
    console.warn(`[push] test send failed for ${stored.id} (${e?.statusCode ?? e?.message ?? 'error'})`);
    return err(502, 'The push service rejected the test notification.');
  }
  return ok({ success: true });
}

// ───────────────────────── dispatcher ─────────────────────────

export interface DispatchSummary {
  success: true;
  subscriptions: number;
  sent: number;
  skippedDuplicates: number;
  failed: number;
  /** Subset of `failed`: sends that hit the per-send timeout (lease left to expire, retried after it). */
  timedOut: number;
  pruned: number;
  /** Subscriptions skipped because they are in failure backoff. */
  backedOff: number;
  /** Subscriptions/events not attempted because the run's time budget ran out (picked up by the next run). */
  deferred: number;
  budgetExceeded: boolean;
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

export function buildPayload(ev: ReturnType<typeof eligibleEvents>[number], now: number, cfg: PushConfig, tzOffsetMinutes?: number): PushPayload {
  const d = describeEvent(ev, now, tzOffsetMinutes);
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

/** 400/401/403: the push service refuses us for this subscription (expired/invalid subscription or VAPID problem). */
export function isRejected(e: any): boolean {
  return e?.statusCode === 400 || e?.statusCode === 401 || e?.statusCode === 403;
}

export class PushTimeoutError extends Error {
  readonly code = 'PUSH_TIMEOUT';
  constructor(ms: number) { super(`push send timed out after ${ms}ms`); }
}

/** Rejects after `ms` even when the underlying operation never settles. The late result of the original promise is swallowed. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PushTimeoutError(ms)), ms); });
  p.catch(() => undefined);
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

function shuffled<T>(a: T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sends every due event exactly once (at-least-once on uncertain outcomes), within a bounded time budget.
 *
 * Lifecycle of an event, per subscription:
 *  1. claim(key, SHORT lease)  – atomic; the winner sends, everyone else skips (no duplicates on overlapping runs).
 *  2. send with a per-send timeout.
 *  3a. success        → markSent(key, 30 days): the lease becomes the permanent sent-marker.
 *  3b. failure        → release(key): retried by the next run (subject to per-subscription backoff).
 *  3c. timeout        → lease is left to expire (the outcome is unknown, the message may still be delivered late),
 *                       so it is retried after the lease instead of hammering a hung push service every minute.
 *  A crashed run therefore never loses an alert: its lease simply expires after minutes, not 30 days.
 *
 * Time budget: subscriptions are processed by a fixed pool of workers; no new send starts after the budget is spent.
 */
export async function dispatchDue(deps: PushDeps): Promise<DispatchSummary> {
  const { store, config } = deps;
  const now = (deps.now ?? Date.now)();
  const sender = deps.sender ?? createWebPushSender(config);
  const policy = endpointPolicyOf(config);
  const startedAt = Date.now(); // real wall clock: the budget is about the function's real runtime, not the injectable "now"
  const overBudget = () => Date.now() - startedAt >= config.dispatchBudgetMs;
  const summary: DispatchSummary = {
    success: true, subscriptions: 0, sent: 0, skippedDuplicates: 0, failed: 0, timedOut: 0, pruned: 0,
    backedOff: 0, deferred: 0, budgetExceeded: false, dispatchedAt: new Date(now).toISOString(),
  };

  const ids = shuffled(await store.listSubscriptionIds()); // shuffled so a budget cut-off does not always starve the same subscriptions
  summary.subscriptions = ids.length;

  const prune = async (id: string) => {
    await store.removeSubscription(id);
    summary.pruned++;
  };

  /** Records a failed attempt; returns true when the subscription was pruned. */
  const recordFailure = async (id: string, e: any): Promise<boolean> => {
    let prev = await store.getHealth(id);
    if (prev && now - prev.lastFailureAt > HEALTH_STALE_MS) prev = null; // failures are only "consecutive" while they keep recurring
    const status: number | string = e?.statusCode ?? (e instanceof PushTimeoutError ? 'timeout' : e?.code ?? 'error');
    const failures = (prev?.failures ?? 0) + 1;
    const rejects = (prev?.rejects ?? 0) + (isRejected(e) ? 1 : 0);
    const firstFailureAt = prev?.firstFailureAt ?? now;
    if (
      rejects >= PRUNE_AFTER_REJECTS ||
      (failures >= PRUNE_AFTER_FAILURES && now - firstFailureAt >= PRUNE_MIN_FAILURE_SPAN_MS)
    ) {
      await prune(id);
      return true;
    }
    const health: SubscriptionHealth = { failures, rejects, firstFailureAt, lastFailureAt: now, nextAttemptAt: now + backoffMs(failures), lastStatus: status };
    await store.setHealth(id, health);
    return false;
  };

  const handleOne = async (id: string) => {
    const [sub, data, health] = await Promise.all([store.getSubscription(id), store.getReminders(id), store.getHealth(id)]);
    if (!sub || !data) return;
    if (!isAllowedPushEndpoint(sub.subscription.endpoint, policy)) {
      // Stored before the allow-list existed (or the list changed): never make a server-side request to it.
      await prune(id);
      return;
    }
    const events = eligibleEvents(data.reminders, now, { maxLateMs: config.maxLateMs });
    if (events.length === 0) return;
    if (health && health.nextAttemptAt > now) {
      summary.backedOff++;
      return;
    }
    let healthCleared = false;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (overBudget()) {
        summary.budgetExceeded = true;
        summary.deferred += events.length - i; // not claimed => the next run sends them
        return;
      }
      const claimKey = `${id}|${ev.key}`;
      if (!(await store.claim(claimKey, config.claimLeaseSeconds))) {
        summary.skippedDuplicates++;
        continue;
      }
      try {
        await withTimeout(
          sender(sub.subscription, JSON.stringify(buildPayload(ev, now, config, data.tzOffsetMinutes)), {
            ttl: REMINDER_PUSH_TTL_SECONDS,
            urgency: 'high',
            topic: ev.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
            timeoutMs: config.sendTimeoutMs,
          }),
          config.sendTimeoutMs,
        );
      } catch (e: any) {
        if (isGone(e)) {
          await prune(id); // 404/410: the subscription is dead, drop it immediately (no retry, no health bookkeeping)
          return;
        }
        summary.failed++;
        if (e instanceof PushTimeoutError) summary.timedOut++; // unknown outcome: lease left to expire, retried after it
        else await store.release(claimKey); // definite failure: retry on a later run
        const pruned = await recordFailure(id, e);
        if (!pruned) console.warn(`[push] send failed for ${id} (${e?.statusCode ?? e?.message ?? 'error'})`);
        return; // remaining events of this subscription wait for the next run / backoff
      }
      // Success: the lease becomes the permanent sent-marker. Retry once; if the store keeps failing the lease expires
      // and the event is re-sent (a duplicate is preferable to a lost alert; the shared notification tag collapses it).
      try {
        await store.markSent(claimKey, SENT_TTL_SECONDS);
      } catch {
        try { await store.markSent(claimKey, SENT_TTL_SECONDS); } catch (e: any) { console.warn('[push] could not persist sent marker:', e?.message); }
      }
      summary.sent++;
      if (health && !healthCleared) { healthCleared = true; await store.setHealth(id, null); }
    }
  };

  // Worker pool over the subscription queue.
  const queue = ids.slice();
  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      if (overBudget()) {
        summary.budgetExceeded = true;
        summary.deferred++;
        continue; // drain the rest of the queue as "deferred"
      }
      try {
        await handleOne(id);
      } catch (e: any) {
        summary.failed++;
        console.warn('[push] dispatch error:', e?.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.dispatchConcurrency, ids.length) }, worker));
  return summary;
}
