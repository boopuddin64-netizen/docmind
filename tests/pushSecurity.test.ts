import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createApiApp } from '../backend/apiApp';
import { subscribe, validateSubscription, type PushConfig, type PushDeps } from '../push-server/core';
import { MemoryStore } from '../push-server/store';
import { createRateLimiter, isAllowedPushEndpoint, parseAllowedHosts, pushGuards } from '../push-server/security';

const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const keys = { p256dh: P256DH, auth: AUTH };
const cfg = (over: Partial<PushConfig> = {}): PushConfig => ({
  publicKey: 'BPubKeyPubKeyPubKeyPubKeyPubKeyPubKey', privateKey: 'priv', subject: 'mailto:t@example.com', cronSecret: 's',
  hideTitles: false, maxLateMs: 6 * 3600_000, allowedHosts: [], allowLocalTestEndpoints: false, maxSubscriptions: 1000,
  sendTimeoutMs: 8000, dispatchBudgetMs: 35_000, dispatchConcurrency: 10, claimLeaseSeconds: 180, ...over,
});

test('endpoint allow-list: accepts the known push services', () => {
  for (const u of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://foo.push.services.mozilla.com/x',
    'https://db5p.notify.windows.com/?token=abc',
    'https://web.push.apple.com/QAbc',
    'https://api.push.apple.com/3/device/abc',
    'https://FCM.GoogleAPIs.com/x', // hostnames are case-insensitive
    'https://fcm.googleapis.com:443/x',
  ]) assert.equal(isAllowedPushEndpoint(u), true, u);
});

test('endpoint allow-list: rejects SSRF targets, IP literals, credentials, odd ports, http, look-alikes', () => {
  for (const u of [
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x', 'https://localhost:3000/x', 'https://foo.localhost/x',
    'https://127.0.0.1/x', 'https://[::1]/x', 'https://[::ffff:169.254.169.254]/x', 'https://0x7f.1/x', 'https://2130706433/x',
    'https://10.0.0.5/x', 'https://192.168.1.1/x',
    'http://fcm.googleapis.com/x',
    'https://user:pw@fcm.googleapis.com/x', 'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com:22/x',
    'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x', 'https://fcm.googleapis.com@evil.com/x',
    'https://push.services.mozilla.com/x', // bare suffix domain itself is not a push endpoint
    'https://notify.windows.com/x', 'https://evilnotify.windows.com/x', 'https://apple.com/x', 'https://push.apple.com/x',
    'https://fcm.googleapis.com./x',
    'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', 'not a url', '',
  ]) assert.equal(isAllowedPushEndpoint(u), false, u);
});

test('endpoint allow-list: PUSH_ALLOWED_HOSTS extends it (exact + wildcard), junk entries ignored', () => {
  const extra = parseAllowedHosts('push.example.org, *.corp.example.org ,10.0.0.1,localhost,*.com,http://x.y,EVIL');
  assert.deepEqual(extra, ['push.example.org', '*.corp.example.org']);
  const p = { extraAllowedHosts: extra };
  assert.equal(isAllowedPushEndpoint('https://push.example.org/x', p), true);
  assert.equal(isAllowedPushEndpoint('https://a.corp.example.org/x', p), true);
  assert.equal(isAllowedPushEndpoint('https://corp.example.org/x', p), false);
  assert.equal(isAllowedPushEndpoint('https://push.example.org/x'), false, 'not allowed without the env');
  assert.equal(isAllowedPushEndpoint('https://evil.com/x', p), false);
});

test('local test endpoints only with the explicit override (default off)', () => {
  const local = 'https://localhost:54321/push/abc';
  assert.equal(isAllowedPushEndpoint(local), false);
  assert.equal(isAllowedPushEndpoint(local, { allowLocalTestEndpoints: false }), false);
  assert.equal(isAllowedPushEndpoint(local, { allowLocalTestEndpoints: true }), true);
  assert.equal(isAllowedPushEndpoint('https://127.0.0.1:1/x', { allowLocalTestEndpoints: true }), true);
  // the override does not open the metadata service or anything else
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/x', { allowLocalTestEndpoints: true }), false);
  assert.equal(isAllowedPushEndpoint('http://localhost:1/x', { allowLocalTestEndpoints: true }), false, 'still https only');
});

test('subscribe key validation: p256dh must decode to a 65-byte uncompressed point, auth to 16 bytes', () => {
  const ep = 'https://fcm.googleapis.com/fcm/send/x';
  assert.ok(validateSubscription({ endpoint: ep, keys }));
  const b = (n: number, first = 4) => { const x = Buffer.alloc(n, 7); if (n) x[0] = first; return x.toString('base64url'); };
  assert.ok(validateSubscription({ endpoint: ep, keys: { p256dh: b(65), auth: b(16) } }));
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: b(64), auth: b(16) } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: b(66), auth: b(16) } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: b(65, 2), auth: b(16) } }), null, 'must be uncompressed (0x04)');
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: b(65), auth: b(15) } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: b(65), auth: b(17) } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: 'AAAAAAAAAA', auth: 'BBBBBBBBBB' } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: P256DH + '!!', auth: AUTH } }), null);
  assert.equal(validateSubscription({ endpoint: ep, keys: { p256dh: 5, auth: AUTH } }), null);
});

test('subscribe: rejects non-allow-listed endpoint (400) and enforces the total subscription cap (503)', async () => {
  const deps: PushDeps = { store: new MemoryStore(), config: cfg({ maxSubscriptions: 2 }) };
  const ep = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys });
  assert.equal((await subscribe(deps, { subscription: { endpoint: 'https://169.254.169.254/x', keys } })).status, 400);
  assert.equal((await subscribe(deps, { subscription: ep(1) })).status, 200);
  assert.equal((await subscribe(deps, { subscription: ep(2) })).status, 200);
  assert.equal((await subscribe(deps, { subscription: ep(3) })).status, 503, 'cap reached');
  assert.equal((await subscribe(deps, { subscription: ep(1) })).status, 200, 're-subscribing an existing endpoint still works at the cap');
  assert.equal(await deps.store.countSubscriptions(), 2);
});

test('rate limiter: fixed window per key, Retry-After, window reset, bounded memory', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t, maxKeys: 3, keyFn: (r: any) => r.ip });
  const hit = (ip: string) => {
    let status = 200; const headers: Record<string, string> = {};
    const res: any = { setHeader: (k: string, v: string) => (headers[k] = v), status: (s: number) => ((status = s), res), json: () => res };
    rl({ ip } as any, res, () => undefined);
    return { status, headers };
  };
  assert.equal(hit('a').status, 200); assert.equal(hit('a').status, 200);
  const blocked = hit('a');
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  assert.equal(hit('b').status, 200, 'other IPs unaffected');
  t = 1001;
  assert.equal(hit('a').status, 200, 'window reset');
  for (const ip of ['c', 'd', 'e', 'f']) hit(ip); // exceeds maxKeys=3: must evict instead of growing
  assert.equal(hit('f').status, 200);
});

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const post = (base: string, path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('HTTP: /api/push/* rate limit (429), small body limit (413), bad JSON (400), other routes keep the big limit', async () => {
  const deps: PushDeps = { store: new MemoryStore(), config: cfg() };
  await withServer(createApiApp(deps), async (base) => {
    // body-size limits
    const big = JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/x', keys }, pad: 'x'.repeat(20_000) });
    assert.equal((await post(base, '/api/push/subscribe', big)).status, 413);
    assert.equal((await post(base, '/api/push/unsubscribe', big)).status, 413);
    assert.equal((await post(base, '/api/push/subscribe', '{bad json')).status, 400);
    const bigSync = JSON.stringify({ subscriptionId: 'a'.repeat(32), reminders: [], pad: 'x'.repeat(300_000) });
    assert.equal((await post(base, '/api/push/sync-reminders', bigSync)).status, 413);
    const midSync = JSON.stringify({ subscriptionId: 'a'.repeat(32), reminders: [], pad: 'x'.repeat(50_000) });
    assert.equal((await post(base, '/api/push/sync-reminders', midSync)).status, 401, 'sync allows larger bodies (reaches auth)');
    // SSRF via the real route
    const ssrf = await post(base, '/api/push/subscribe', JSON.stringify({ subscription: { endpoint: 'https://169.254.169.254/latest', keys } }));
    assert.equal(ssrf.status, 400);
    // non-push routes still accept large bodies (document scans)
    const scan = await post(base, '/api/scan-document', JSON.stringify({ documentText: 'x'.repeat(200_000) }));
    assert.notEqual(scan.status, 413);
  });
});

test('HTTP: per-IP rate limit on /api/push/*, stricter on subscribe', async () => {
  const app = express();
  app.use('/api/push', ...pushGuards({ general: { windowMs: 60_000, max: 5 }, subscribe: { windowMs: 60_000, max: 2 } }));
  app.use((_req, res) => { res.json({ ok: true }); });
  await withServer(app, async (base) => {
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await post(base, '/api/push/subscribe', '{}')).status);
    assert.deepEqual(codes, [200, 200, 429], 'subscribe limited to 2 per window');
    const g: number[] = [];
    for (let i = 0; i < 4; i++) g.push((await fetch(base + '/api/push/public-key')).status);
    // 3 requests already used (incl. the 429 one), general max is 5
    assert.deepEqual(g, [200, 200, 429, 429]);
    const r = await fetch(base + '/api/push/public-key');
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal((await fetch(base + '/other')).status, 200, 'non-push paths are not limited');
  });
});
