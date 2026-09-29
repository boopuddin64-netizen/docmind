import type { Express, Request, Response } from 'express';
import {
  dispatchDue,
  getPublicKey,
  isConfigured,
  isCronAuthorized,
  loadConfig,
  subscribe,
  syncReminders,
  unsubscribe,
  type ApiResult,
  type PushDeps,
} from './core.js';
import { createStore, type PushStore } from './store.js';

let cached: PushDeps | null = null;

/** Lazily-created singleton deps (config from env + storage adapter). Tests can inject their own via registerPushRoutes(app, deps). */
export function getPushDeps(): PushDeps {
  if (!cached) cached = { store: createStore(), config: loadConfig() };
  return cached;
}

function send(res: Response, r: ApiResult) {
  res.status(r.status).json(r.body);
}

const guard = (fn: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e: any) {
    console.error('[push] endpoint error:', e?.message);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
};

export function registerPushRoutes(app: Express, deps?: PushDeps | (() => PushDeps)) {
  const d = () => (typeof deps === 'function' ? deps() : deps ?? getPushDeps());
  const bearer = (req: Request) => req.headers.authorization;

  app.get('/api/push/public-key', guard((_req, res) => send(res, getPublicKey(d()))));
  app.post('/api/push/subscribe', guard(async (req, res) => send(res, await subscribe(d(), req.body))));
  app.post('/api/push/unsubscribe', guard(async (req, res) => send(res, await unsubscribe(d(), req.body, bearer(req)))));
  app.post('/api/push/sync-reminders', guard(async (req, res) => send(res, await syncReminders(d(), req.body, bearer(req)))));

  // Cron / dispatch endpoint. Called every minute by an external timer (cron-job.org) or by Vercel Cron.
  // Both send `Authorization: Bearer <CRON_SECRET>`. GET and POST are both accepted.
  const dispatch = guard(async (req, res) => {
    const deps = d();
    if (!isCronAuthorized(bearer(req), deps.config)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isConfigured(deps.config)) {
      res.status(503).json({ success: false, error: 'Web Push is not configured on the server (VAPID keys missing).' });
      return;
    }
    res.json(await dispatchDue(deps));
  });
  app.get('/api/dispatch-alerts', dispatch);
  app.post('/api/dispatch-alerts', dispatch);
}

/**
 * Local / long-running-host convenience only: run the dispatcher on an interval inside the server process.
 * NOT used on Vercel (serverless functions cannot keep timers alive) — there an external cron calls /api/dispatch-alerts.
 */
export function startLocalScheduler(intervalMs = Math.max(1000, Number(process.env.PUSH_SCHEDULER_INTERVAL_MS) || 30_000)): (() => void) | null {
  if (process.env.VERCEL || process.env.PUSH_LOCAL_SCHEDULER === '0') return null;
  const deps = getPushDeps();
  if (!isConfigured(deps.config)) {
    console.log('[push] VAPID keys not set: Web Push disabled (run `npm run generate-vapid`).');
    return null;
  }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const s = await dispatchDue(deps);
      if (s.sent || s.failed || s.pruned) console.log('[push] dispatch', JSON.stringify(s));
    } catch (e: any) {
      console.warn('[push] scheduler error:', e?.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  console.log(`[push] local scheduler running every ${intervalMs / 1000}s`);
  return () => clearInterval(timer);
}

export type { PushStore };
