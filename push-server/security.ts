/**
 * Request-level protections for /api/push/*: push-endpoint allow-list (SSRF), per-IP rate limiting,
 * and small body-size limits.
 */
import net from 'node:net';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

// ───────────────────────── push endpoint allow-list (SSRF) ─────────────────────────

/** Exact hostnames of the browser push services. */
export const DEFAULT_ALLOWED_HOSTS = [
  'fcm.googleapis.com', // Chrome / Edge / Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari / iOS PWAs
];
/** Hostname suffixes (a dot is required in front, so the bare suffix itself is not matched). */
export const DEFAULT_ALLOWED_SUFFIXES = [
  '.push.services.mozilla.com',
  '.notify.windows.com', // WNS (legacy Edge / Windows)
  '.push.apple.com',
];

export interface EndpointPolicy {
  /** Extra allowed hosts from PUSH_ALLOWED_HOSTS ("host.example" exact, or "*.example.com" wildcard). */
  extraAllowedHosts?: string[];
  /**
   * TEST ONLY: also accept https://localhost / https://127.0.0.1 on any port (used by the e2e test's fake push
   * service). Must be switched on explicitly through PUSH_ALLOW_LOCAL_TEST_ENDPOINTS=1; never enabled by default,
   * and ignored on Vercel.
   */
  allowLocalTestEndpoints?: boolean;
}

const HOST_ENTRY = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Parses PUSH_ALLOWED_HOSTS (comma/space separated). Invalid entries, IP literals and bare TLD wildcards are dropped. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw || '').split(/[\s,]+/)) {
    const h = part.trim().toLowerCase();
    if (!h || !HOST_ENTRY.test(h) || net.isIP(h.replace(/^\*\./, ''))) continue;
    if (h.startsWith('*.') && h.slice(2).split('.').length < 2) continue;
    out.push(h);
  }
  return out;
}

function hostAllowed(host: string, extra: string[]): boolean {
  if (DEFAULT_ALLOWED_HOSTS.includes(host)) return true;
  if (DEFAULT_ALLOWED_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return true;
  for (const e of extra) {
    if (e.startsWith('*.')) {
      const suffix = e.slice(1); // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
    } else if (host === e) return true;
  }
  return false;
}

/** true only for https URLs on a known push-service host: no credentials, no odd port, no IP literal, no localhost. */
export function isAllowedPushEndpoint(endpoint: string, policy: EndpointPolicy = {}): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith('.')) return false;
  if (policy.allowLocalTestEndpoints && (host === 'localhost' || host === '127.0.0.1')) return true;
  if (url.port && url.port !== '443') return false;
  if (host === 'localhost' || host.endsWith('.localhost') || net.isIP(host.replace(/^\[|\]$/g, '')) || host.startsWith('[')) return false;
  return hostAllowed(host, policy.extraAllowedHosts ?? []);
}

// ───────────────────────── rate limiting ─────────────────────────

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Upper bound on tracked clients (memory safety). */
  maxKeys?: number;
  now?: () => number;
  keyFn?: (req: Request) => string;
}

/**
 * Client IP. Behind Vercel's proxy the socket address is the proxy, so the platform-set headers are used there
 * (or when PUSH_TRUST_PROXY=1). Elsewhere client-supplied forwarding headers are ignored (they are spoofable).
 */
export function clientIp(req: Request): string {
  if (process.env.VERCEL || process.env.PUSH_TRUST_PROXY === '1') {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window, in-memory, per-IP limiter.
 * NOTE (serverless): state lives inside one function instance. On Vercel each warm instance keeps its own counters
 * and cold starts reset them, so this is best-effort abuse damping, not a global quota. The hard global bounds are
 * the subscription cap (PUSH_MAX_SUBSCRIPTIONS) and the strict per-request validation.
 */
export function createRateLimiter(opts: RateLimitOptions): RequestHandler & { reset(): void } {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;
  const clock = opts.now ?? Date.now;
  const mw: RequestHandler = (req, res, next) => {
    const now = clock();
    const key = (opts.keyFn ?? clientIp)(req);
    let e = hits.get(key);
    if (!e || e.resetAt <= now) {
      if (!e && hits.size >= maxKeys) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string); // evict oldest
      }
      e = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, e);
    }
    e.count++;
    if (e.count > opts.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((e.resetAt - now) / 1000))));
      res.status(429).json({ success: false, error: 'Too many requests. Please slow down.' });
      return;
    }
    next();
  };
  return Object.assign(mw, { reset: () => hits.clear() });
}

// ───────────────────────── body limits + guard bundle ─────────────────────────

export const PUSH_BODY_LIMIT_DEFAULT = '8kb';
/** 500 reminders (id + title + numbers) fit comfortably; anything bigger is not a legitimate sync. */
export const PUSH_BODY_LIMIT_SYNC = '256kb';

export interface PushGuardOptions {
  /** All /api/push/* requests per IP. */
  general?: { windowMs: number; max: number };
  /** POST /api/push/subscribe per IP (stricter: each one creates stored data). */
  subscribe?: { windowMs: number; max: number };
  now?: () => number;
}

/**
 * Middleware bundle to mount BEFORE the app-wide JSON parser: rate limit → small per-route body limit → JSON error mapping.
 * Mount with `app.use('/api/push', ...pushGuards())`.
 */
export function pushGuards(opts: PushGuardOptions = {}): Array<RequestHandler | ((err: any, req: Request, res: Response, next: NextFunction) => void)> {
  const general = createRateLimiter({ windowMs: opts.general?.windowMs ?? 60_000, max: opts.general?.max ?? 60, now: opts.now });
  const subscribeLimit = createRateLimiter({ windowMs: opts.subscribe?.windowMs ?? 10 * 60_000, max: opts.subscribe?.max ?? 10, now: opts.now });
  const small = express.json({ limit: PUSH_BODY_LIMIT_DEFAULT });
  const sync = express.json({ limit: PUSH_BODY_LIMIT_SYNC });
  return [
    general,
    ((req, res, next) => (req.method === 'POST' && req.path === '/subscribe' ? subscribeLimit(req, res, next) : next())) as RequestHandler,
    ((req, res, next) => (req.path === '/sync-reminders' ? sync(req, res, next) : small(req, res, next))) as RequestHandler,
    (err: any, _req: Request, res: Response, next: NextFunction) => {
      if (err?.type === 'entity.too.large') return void res.status(413).json({ success: false, error: 'Request body too large.' });
      if (err?.type === 'entity.parse.failed') return void res.status(400).json({ success: false, error: 'Invalid JSON' });
      if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') {
        return void res.status(400).json({ success: false, error: 'Invalid request body.' });
      }
      next(err);
    },
  ];
}
