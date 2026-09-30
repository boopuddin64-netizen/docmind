import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import vm from 'node:vm';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import webpush from 'web-push';
import {
  REMINDER_PUSH_TTL_SECONDS, TEST_PUSH_COOLDOWN_SECONDS, TEST_PUSH_TTL_SECONDS,
  createWebPushSender, dispatchDue, sendTestPush, subscribe, syncReminders, type PushConfig, type PushDeps, type PushSender,
} from '../push-server/core';
import { MemoryStore } from '../push-server/store';
import { pushGuards } from '../push-server/security';
import { registerPushRoutes } from '../push-server/routes';
import { loudNotificationOptions, NOTIFICATION_BADGE, VIBRATE_PATTERN } from '../src/lib/notificationOptions';
import { sendTestPush as clientSendTestPush } from '../src/lib/pushClient';

const cfg: PushConfig = {
  publicKey: 'BPubKeyPubKeyPubKeyPubKeyPubKeyPubKey', privateKey: 'priv', subject: 'mailto:t@example.com', cronSecret: 's', hideTitles: false,
  maxLateMs: 6 * 3600_000, allowedHosts: [], allowLocalTestEndpoints: false, maxSubscriptions: 100, sendTimeoutMs: 8000, dispatchBudgetMs: 35_000,
  dispatchConcurrency: 4, claimLeaseSeconds: 180,
};
const goodSub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/loud${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

function setup() {
  const clock = { t: 1_900_000_000_000 };
  const sent: Array<{ endpoint: string; payload: any; opts: any }> = [];
  let fail: any = null;
  const sender: PushSender = async (s, payload, opts) => { if (fail) throw fail; sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), opts }); };
  const deps: PushDeps = { store: new MemoryStore(undefined, () => clock.t), config: cfg, sender, now: () => clock.t };
  return { deps, sent, clock, failWith: (e: any) => (fail = e) };
}
async function reg(deps: PushDeps, n = 1) {
  const r: any = await subscribe(deps, { subscription: goodSub(n) });
  return { id: r.body.subscriptionId as string, auth: `Bearer ${r.body.token}` };
}

// ───────── 1. Web Push message options ─────────
test('web-push: sendNotification gets urgency "high" and a multi-hour TTL', async () => {
  const calls: any[] = [];
  const orig = webpush.sendNotification;
  (webpush as any).sendNotification = async (_s: unknown, _p: unknown, o: unknown) => void calls.push(o);
  try {
    const send = createWebPushSender({ ...cfg, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', privateKey: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls' });
    await send(goodSub() as any, '{}', { ttl: REMINDER_PUSH_TTL_SECONDS, urgency: 'high', topic: 'x', timeoutMs: 1000 });
    assert.equal(calls[0].urgency, 'high');
    assert.equal(calls[0].TTL, REMINDER_PUSH_TTL_SECONDS);
    assert.ok(REMINDER_PUSH_TTL_SECONDS >= 3 * 3600 && REMINDER_PUSH_TTL_SECONDS <= 24 * 3600, 'a few hours');
  } finally { (webpush as any).sendNotification = orig; }
});

test('dispatch: reminders are sent high urgency with the reminder TTL', async () => {
  const { deps, sent, clock } = setup();
  const { id, auth } = await reg(deps);
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'Rent', dueAt: clock.t - 1000, leadMinutes: 0 }] }, auth);
  await dispatchDue(deps);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].opts.urgency, 'high');
  assert.equal(sent[0].opts.ttl, REMINDER_PUSH_TTL_SECONDS);
  assert.equal(sent[0].payload.title, 'Rent');
  assert.equal(sent[0].payload.body, 'Due now');
});

// ───────── 4. test push endpoint ─────────
test('test push: authenticated by subscription, high urgency, short TTL, real payload with a unique tag', async () => {
  const { deps, sent, clock } = setup();
  const { id, auth } = await reg(deps);
  const r = await sendTestPush(deps, { subscriptionId: id }, auth);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, goodSub().endpoint, 'goes to the caller\'s own subscription');
  assert.equal(sent[0].opts.urgency, 'high');
  assert.equal(sent[0].opts.ttl, TEST_PUSH_TTL_SECONDS);
  assert.equal(sent[0].payload.test, true);
  assert.match(sent[0].payload.tag, /^docmind-test-\d+$/);
  assert.ok(sent[0].payload.title && sent[0].payload.body);
  clock.t += (TEST_PUSH_COOLDOWN_SECONDS + 1) * 1000;
  await sendTestPush(deps, { subscriptionId: id }, auth);
  assert.notEqual(sent[1].payload.tag, sent[0].payload.tag, 'each test is a new notification, never a silent replacement');
});

test('test push: rejects missing / wrong token and unknown subscription; nothing is sent', async () => {
  const { deps, sent } = setup();
  const { id, auth } = await reg(deps);
  assert.equal((await sendTestPush(deps, { subscriptionId: id }, undefined)).status, 401);
  assert.equal((await sendTestPush(deps, { subscriptionId: id }, 'Bearer nope')).status, 401);
  assert.equal((await sendTestPush(deps, { subscriptionId: 'a'.repeat(32) }, auth)).status, 401);
  assert.equal((await sendTestPush(deps, {}, auth)).status, 401);
  assert.equal(sent.length, 0);
  // another user's token cannot trigger a push to this subscription
  const other = await reg(deps, 2);
  assert.equal((await sendTestPush(deps, { subscriptionId: id }, other.auth)).status, 401);
  assert.equal(sent.length, 0);
});

test('test push: per-subscription rate limit (429), independent between subscriptions, released after a failed send', async () => {
  const { deps, sent, clock, failWith } = setup();
  const a = await reg(deps, 1);
  const b = await reg(deps, 2);
  assert.equal((await sendTestPush(deps, { subscriptionId: a.id }, a.auth)).status, 200);
  const limited: any = await sendTestPush(deps, { subscriptionId: a.id }, a.auth);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.retryAfterSeconds, TEST_PUSH_COOLDOWN_SECONDS);
  assert.equal((await sendTestPush(deps, { subscriptionId: b.id }, b.auth)).status, 200, 'other subscription unaffected');
  assert.equal(sent.length, 2);
  clock.t += (TEST_PUSH_COOLDOWN_SECONDS + 1) * 1000;
  assert.equal((await sendTestPush(deps, { subscriptionId: a.id }, a.auth)).status, 200, 'allowed again after the cooldown');
  // a failed send does not burn the cooldown
  clock.t += (TEST_PUSH_COOLDOWN_SECONDS + 1) * 1000;
  failWith({ statusCode: 500 });
  assert.equal((await sendTestPush(deps, { subscriptionId: a.id }, a.auth)).status, 502);
  failWith(null);
  assert.equal((await sendTestPush(deps, { subscriptionId: a.id }, a.auth)).status, 200);
});

test('test push: a dead subscription (410) is pruned and reported', async () => {
  const { deps, failWith } = setup();
  const { id, auth } = await reg(deps);
  failWith({ statusCode: 410 });
  assert.equal((await sendTestPush(deps, { subscriptionId: id }, auth)).status, 410);
  assert.equal(await deps.store.getSubscription(id), null);
});

test('test push: 503 when push is not configured', async () => {
  const { deps } = setup();
  assert.equal((await sendTestPush({ ...deps, config: { ...cfg, publicKey: '' } }, {}, undefined)).status, 503);
});

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server: Server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}

test('HTTP: POST /api/push/test works end to end, with the per-IP guard and body limit in front', async () => {
  const { deps, sent, clock } = setup();
  const { id, auth } = await reg(deps);
  const app = express();
  app.use('/api/push', ...pushGuards({ test: { windowMs: 60_000, max: 3 } }));
  registerPushRoutes(app, deps);
  await withServer(app, async (base) => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(base + '/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ subscriptionId: id })).status, 401, 'no bearer token');
    assert.equal((await post({ subscriptionId: id }, { Authorization: auth })).status, 200);
    assert.equal(sent.length, 1);
    assert.equal((await post({ subscriptionId: id }, { Authorization: auth })).status, 429, 'per-subscription cooldown');
    clock.t += 60_000;
    assert.equal((await post({ subscriptionId: id }, { Authorization: auth })).status, 429, '4th request in the window hits the per-IP limit');
    assert.equal((await post({ pad: 'x'.repeat(20_000) }, { Authorization: auth })).status, 429);
  });
  const app2 = express();
  app2.use('/api/push', ...pushGuards());
  registerPushRoutes(app2, deps);
  await withServer(app2, async (base) => {
    const r = await fetch(base + '/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(20_000) }) });
    assert.equal(r.status, 413, 'small body limit still applies');
  });
});

test('client: sendTestPush uses the stored subscription + bearer token and maps failures to messages', async () => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const res = (status: number) => ({ status, ok: status < 300, json: async () => ({}) }) as any;
  assert.equal((await clientSendTestPush(async () => res(200))) .ok, false, 'not subscribed yet');
  mem.set('docmind_push_sub_v1', JSON.stringify({ subscriptionId: 'a'.repeat(32), token: 'tok', endpoint: 'https://fcm.googleapis.com/x' }));
  let seen: any;
  assert.deepEqual(await clientSendTestPush((async (u: string, init: any) => { seen = { u, init }; return res(200); }) as any), { ok: true });
  assert.equal(seen.u, '/api/push/test');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(seen.init.body).subscriptionId, 'a'.repeat(32));
  const r429: any = await clientSendTestPush(async () => res(429));
  assert.equal(r429.reason, 'rate-limited');
  assert.equal((await clientSendTestPush(async () => { throw new TypeError('offline'); }) as any).reason, 'error');
  const r401: any = await clientSendTestPush(async () => res(401));
  assert.equal(r401.reason, 'gone');
  assert.equal(mem.has('docmind_push_sub_v1'), false);
});

// ───────── 2/3. service worker + page notification options ─────────
async function loadSw() {
  const src = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners: Record<string, (e: any) => void> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const order: string[] = [];
  const cacheWrites: string[] = [];
  const opened: string[] = [];
  const posted: any[] = [];
  let clientsList: any[] = [];
  let showFails = false;
  const self: any = {
    location: { origin: 'https://app.example' },
    addEventListener: (t: string, f: (e: any) => void) => { listeners[t] = f; },
    skipWaiting() {},
    registration: {
      showNotification: async (title: string, options: any) => { order.push('show'); if (showFails) throw new Error('boom'); shown.push(JSON.parse(JSON.stringify({ title, options }))); },
    },
    clients: {
      matchAll: async () => clientsList,
      openWindow: async (u: string) => void opened.push(u),
      claim: async () => {},
    },
  };
  const ctx: any = {
    self, URL, Response: class { constructor(public b: string) {} }, console,
    caches: { open: async () => ({ put: async (k: string) => { order.push('cache'); cacheWrites.push(k); }, add: async () => {} }), keys: async () => [], match: async () => undefined, delete: async () => true },
    fetch: async () => ({}),
  };
  vm.runInNewContext(src, ctx);
  const push = async (data: unknown, raw = false) => {
    let p: Promise<unknown> = Promise.resolve();
    const event = { data: raw ? { json: () => { throw new Error('not json'); }, text: () => String(data) } : { json: () => data, text: () => JSON.stringify(data) }, waitUntil: (x: Promise<unknown>) => { p = x; } };
    listeners.push(event);
    await p;
  };
  const click = async (action: string, data: any) => {
    let p: Promise<unknown> = Promise.resolve();
    let closed = false;
    listeners.notificationclick({ action, notification: { data, close: () => { closed = true; } }, waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    return closed;
  };
  return {
    src, shown, order, cacheWrites, opened, posted, push, click,
    setClients: (l: any[]) => { clientsList = l; },
    failShow: (v: boolean) => { showFails = v; },
    cacheName: /const CACHE_NAME = "([^"]+)"/.exec(src)![1],
  };
}

test('sw: push shows a loud heads-up notification (vibrate, not silent, sticky, renotify, unique tag, badge, icon, timestamp, actions)', async () => {
  const sw = await loadSw();
  await sw.push({ title: 'Renew passport', body: 'Due in 30 minute(s)', reminderId: 'rem-1', tag: 'rem-1', eventKey: 'rem-1:1:lead', dueAt: 123, url: '/' });
  const { title, options } = sw.shown[0];
  assert.equal(title, 'Renew passport');
  assert.equal(options.body, 'Due in 30 minute(s)');
  assert.equal(options.silent, false);
  assert.equal(options.requireInteraction, true);
  assert.equal(options.renotify, true);
  assert.deepEqual(options.vibrate, [300, 150, 300, 150, 600]);
  assert.deepEqual(options.vibrate, [...VIBRATE_PATTERN]);
  assert.equal(options.tag, 'rem-1');
  assert.equal(options.icon, '/icon-192.png');
  assert.equal(options.badge, NOTIFICATION_BADGE);
  assert.ok(Math.abs(options.timestamp - Date.now()) < 5000);
  assert.deepEqual(options.actions.map((a: any) => a.action), ['snooze', 'done']);
  assert.match(options.actions[0].title, /Snooze/);
  assert.equal(options.actions[1].title, 'Mark done');
  assert.equal(options.data.reminderId, 'rem-1');
});

test('sw: page-side options match the service worker options (same loud set)', async () => {
  const sw = await loadSw();
  await sw.push({ title: 't', body: 'b', reminderId: 'x', tag: 'x' });
  const page = loudNotificationOptions({ body: 'b', tag: 'x', reminderId: 'x' });
  for (const k of ['silent', 'requireInteraction', 'renotify', 'vibrate', 'badge', 'icon', 'tag'] as const) {
    assert.deepEqual((page as any)[k], sw.shown[0].options[k], k);
  }
});

test('sw: no code path uses silent:true, and every showNotification call sets vibrate', async () => {
  const sw = await loadSw();
  assert.doesNotMatch(sw.src, /silent\s*:\s*true/);
  const page = await fs.readFile(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /silent\s*:\s*true/);
  assert.match(page, /loudNotificationOptions\(/);
  assert.equal((sw.src.match(/showNotification\(/g) || []).length, 1, 'single notification code path in the SW');
});

test('sw: unclear payloads still produce a clear title/body; test pushes are loud too', async () => {
  const sw = await loadSw();
  await sw.push({});
  assert.equal(sw.shown[0].title, 'DocuMind reminder');
  assert.ok(sw.shown[0].options.body.length > 10);
  assert.deepEqual(sw.shown[0].options.actions, [], 'no action buttons without a reminder id');
  await sw.push('plain text body', true);
  assert.equal(sw.shown[1].options.body, 'plain text body');
  await sw.push({ title: 'DocuMind test alert', body: 'hi', test: true, tag: 'docmind-test-1', reminderId: '' });
  assert.equal(sw.shown[2].options.silent, false);
  assert.equal(sw.shown[2].options.requireInteraction, true);
  assert.equal(sw.shown[2].options.tag, 'docmind-test-1');
  // two payloads without a tag never share one (no silent replacement)
  await sw.push({ title: 'a' });
  await sw.push({ title: 'b' });
  assert.ok(sw.shown[3].options.tag.startsWith('docmind-reminder-'));
});

test('sw: the event is marked delivered only AFTER the notification was shown; a failed show is not marked', async () => {
  const sw = await loadSw();
  await sw.push({ title: 'x', body: 'y', reminderId: 'r', tag: 'r', eventKey: 'r:1:due' });
  assert.deepEqual(sw.order, ['show', 'cache']);
  assert.deepEqual(sw.cacheWrites, ['/__fired/r%3A1%3Adue']);
  const sw2 = await loadSw();
  sw2.failShow(true);
  await assert.rejects(() => sw2.push({ title: 'x', body: 'y', reminderId: 'r', eventKey: 'r:1:due' }));
  assert.deepEqual(sw2.cacheWrites, []);
});

test('sw: cache name is v9 (one above v8)', async () => {
  const sw = await loadSw();
  assert.equal(sw.cacheName, 'docmind-pwa-v9');
  assert.match(sw.src, /"\/badge-96\.png"/, 'badge is precached');
});

test('sw: clicking opens the app; "Snooze…" deep-links to /?snooze=<id>; "Mark done" applies from the URL when closed', async () => {
  const sw = await loadSw();
  const d = { reminderId: 'rem 1/x', url: '/' };
  assert.equal(await sw.click('', d), true, 'notification is closed on click');
  assert.deepEqual(sw.opened, ['/']);
  await sw.click('snooze', d);
  assert.equal(sw.opened[1], '/?snooze=rem+1%2Fx');
  assert.equal(new URLSearchParams(sw.opened[1].split('?')[1]).get('snooze'), 'rem 1/x');
  await sw.click('done', d);
  const q = new URLSearchParams(sw.opened[2].split('?')[1]);
  assert.equal(q.get('dm_action'), 'done');
  assert.equal(q.get('dm_id'), 'rem 1/x');
});

test('sw: with the app already open, snooze focuses it and posts the action; done does not steal focus', async () => {
  const sw = await loadSw();
  const msgs: any[] = [];
  let focused = 0;
  sw.setClients([{ focused: false, postMessage: (m: any) => msgs.push(JSON.parse(JSON.stringify(m))), focus: async () => { focused++; } }]);
  await sw.click('snooze', { reminderId: 'a' });
  assert.deepEqual(msgs[0], { type: 'docmind-notification-action', action: 'snooze', reminderId: 'a' });
  assert.equal(focused, 1);
  await sw.click('', { reminderId: 'a' });
  assert.equal(focused, 2);
  await sw.click('done', { reminderId: 'a' });
  assert.equal(msgs[2].action, 'done');
  assert.equal(focused, 2);
  assert.deepEqual(sw.opened, []);
});
