import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPayload,
  dispatchDue,
  getPublicKey,
  isCronAuthorized,
  loadConfig,
  subscribe,
  subscriptionIdFor,
  syncReminders,
  unsubscribe,
  validateReminders,
  validateSubscription,
  type PushConfig,
  type PushDeps,
  type PushSender,
} from '../push-server/core';
import { MemoryStore } from '../push-server/store';

const cfg = (over: Partial<PushConfig> = {}): PushConfig => ({
  publicKey: 'BPubKeyPubKeyPubKeyPubKeyPubKeyPubKey', privateKey: 'priv', subject: 'mailto:t@example.com',
  cronSecret: 's3cret', hideTitles: false, maxLateMs: 6 * 3600_000,
  allowedHosts: [], allowLocalTestEndpoints: false, maxSubscriptions: 1000, sendTimeoutMs: 8000, dispatchBudgetMs: 35_000,
  dispatchConcurrency: 10, claimLeaseSeconds: 180, ...over,
});
const goodSub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

function setup(over: Partial<PushConfig> = {}, now = { t: 1_000_000_000_000 }) {
  const sent: Array<{ endpoint: string; payload: any; opts: any }> = [];
  let behavior: (endpoint: string) => any = () => undefined;
  const sender: PushSender = async (sub, payload, opts) => {
    const b = behavior(sub.endpoint);
    if (b) throw b;
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts });
  };
  const deps: PushDeps = { store: new MemoryStore(undefined, () => now.t), config: cfg(over), sender, now: () => now.t };
  return { deps, sent, now, setBehavior: (f: (e: string) => any) => (behavior = f) };
}

async function registered(deps: PushDeps, n = 1) {
  const r: any = await subscribe(deps, { subscription: goodSub(n) });
  assert.equal(r.status, 200);
  return { id: r.body.subscriptionId as string, auth: `Bearer ${r.body.token}` };
}

test('cron auth: fails closed without CRON_SECRET, requires exact bearer', () => {
  assert.equal(isCronAuthorized('Bearer x', cfg({ cronSecret: '' })), false);
  assert.equal(isCronAuthorized(undefined, cfg()), false);
  assert.equal(isCronAuthorized('Bearer nope', cfg()), false);
  assert.equal(isCronAuthorized('s3cret', cfg()), false);
  assert.equal(isCronAuthorized('Bearer s3cret', cfg()), true);
  assert.equal(isCronAuthorized('bearer   s3cret ', cfg()), true);
});

test('loadConfig reads env; public key endpoint 503 when unconfigured', () => {
  const c = loadConfig({ VAPID_PUBLIC_KEY: ' a ', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:x@y.z', CRON_SECRET: 'c', PUSH_HIDE_TITLES: '1' });
  assert.equal(c.publicKey, 'a'); assert.equal(c.hideTitles, true);
  assert.equal(getPublicKey({ store: new MemoryStore(), config: loadConfig({}) }).status, 503);
  assert.equal(getPublicKey({ store: new MemoryStore(), config: c }).status, 200);
  assert.equal(getPublicKey({ store: new MemoryStore(), config: { ...c, subject: 'bad' } }).status, 503);
});

test('validateSubscription: https only, key format, length', () => {
  assert.ok(validateSubscription(goodSub()));
  assert.equal(validateSubscription({ ...goodSub(), endpoint: 'http://fcm.googleapis.com/x' }), null);
  assert.equal(validateSubscription({ ...goodSub(), endpoint: 'javascript:alert(1)' }), null);
  assert.equal(validateSubscription({ ...goodSub(), endpoint: 'https://fcm.googleapis.com/' + 'a'.repeat(2000) }), null);
  assert.equal(validateSubscription({ endpoint: goodSub().endpoint, keys: { p256dh: '!!', auth: 'x' } }), null);
  assert.equal(validateSubscription(null), null);
});

test('validateReminders: size limit, types, dedupe by id (last wins), clamps', () => {
  const { reminders: ok } = validateReminders([
    { id: 'a', title: 'one', dueAt: 1000, leadMinutes: 30 },
    { id: 'a', title: 'two', dueAt: 2000 },
    { id: 'b', title: 'x'.repeat(500), dueAt: 3000, leadMinutes: 5, snoozedUntil: 9000 },
  ])!;
  assert.equal(ok.length, 2);
  assert.equal(ok.find((r) => r.id === 'a')!.title, 'two');
  assert.equal(ok.find((r) => r.id === 'b')!.title.length, 120);
  assert.equal(ok.find((r) => r.id === 'b')!.snoozedUntil, 9000);
  assert.equal(validateReminders(Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, title: 't', dueAt: 1 }))), null);
  // invalid ITEMS are skipped (and counted); they no longer fail the whole payload
  for (const bad of [{ id: '', title: 't', dueAt: 1 }, { id: 'a', title: 't', dueAt: 'soon' }, { id: 'a', title: 't', dueAt: 1, leadMinutes: -5 }, { id: 'a', title: 't', dueAt: 1, leadMinutes: 10 ** 9 }, null, 'x']) {
    assert.deepEqual(validateReminders([bad]), { reminders: [], skipped: 1 });
  }
  assert.equal(validateReminders('nope'), null);
});

test('subscribe → sync requires the per-subscription bearer token', async () => {
  const { deps } = setup();
  const { id, auth } = await registered(deps);
  assert.equal(id, subscriptionIdFor(goodSub().endpoint));
  const body = { subscriptionId: id, tzOffsetMinutes: -60, reminders: [{ id: 'a', title: 't', dueAt: Date.now() }] };
  assert.equal((await syncReminders(deps, body, undefined)).status, 401);
  assert.equal((await syncReminders(deps, body, 'Bearer wrong')).status, 401);
  assert.equal((await syncReminders(deps, body, auth)).status, 200);
  assert.equal((await syncReminders(deps, { ...body, subscriptionId: 'f'.repeat(32) }, auth)).status, 401);
  assert.equal((await syncReminders(deps, { ...body, reminders: 'bad' }, auth)).status, 400);
  assert.equal((await deps.store.getReminders(id))!.reminders.length, 1);
});

test('unsubscribe removes subscription + reminders; needs token', async () => {
  const { deps } = setup();
  const { id, auth } = await registered(deps);
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'a', title: 't', dueAt: 1 }] }, auth);
  assert.equal((await unsubscribe(deps, { subscriptionId: id }, 'Bearer nope')).status, 401);
  assert.equal((await unsubscribe(deps, { subscriptionId: id }, auth)).status, 200);
  assert.equal(await deps.store.getSubscription(id), null);
  assert.equal(await deps.store.getReminders(id), null);
});

test('dispatch: sends once when due, never twice (repeat runs + concurrent runs)', async () => {
  const { deps, sent, now } = setup();
  const { id, auth } = await registered(deps);
  const dueAt = now.t + 10 * 60_000;
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'Pay rent', dueAt, leadMinutes: 0 }] }, auth);

  let s = await dispatchDue(deps);
  assert.equal(s.sent, 0);
  now.t = dueAt + 1000;
  const [a, b] = await Promise.all([dispatchDue(deps), dispatchDue(deps)]); // overlapping cron invocations
  assert.equal(a.sent + b.sent, 1);
  assert.equal(a.skippedDuplicates + b.skippedDuplicates, 1);
  now.t += 30_000;
  s = await dispatchDue(deps);
  assert.equal(s.sent, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.tag, 'r1');
  assert.equal(sent[0].payload.title, 'Pay rent');
  assert.equal(sent[0].opts.urgency, 'high');
});

test('dispatch: heads-up then due are two pushes with the same tag; completed/deleted reminders are not sent', async () => {
  const { deps, sent, now } = setup();
  const { id, auth } = await registered(deps);
  const dueAt = now.t + 2 * 3600_000;
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'Flight', dueAt, leadMinutes: 60 }, { id: 'r2', title: 'Gone', dueAt, leadMinutes: 60 }] }, auth);
  now.t = dueAt - 30 * 60_000;
  await dispatchDue(deps);
  assert.equal(sent.length, 2);
  // user marks r2 done => client syncs a list without it
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'Flight', dueAt, leadMinutes: 60 }] }, auth);
  now.t = dueAt + 1000;
  await dispatchDue(deps);
  assert.deepEqual(sent.map((x) => x.payload.reminderId + ':' + x.payload.body), ['r1:Due in 30 minute(s)', 'r2:Due in 30 minute(s)', 'r1:Due now']);
  assert.ok(sent.every((x) => x.payload.tag === x.payload.reminderId));
});

test('dispatch: snooze pushes the alert back, and re-sync after snooze does not duplicate', async () => {
  const { deps, sent, now } = setup();
  const { id, auth } = await registered(deps);
  const dueAt = now.t + 60_000;
  const base = { id: 'r1', title: 'Meds', dueAt, leadMinutes: 0 };
  await syncReminders(deps, { subscriptionId: id, reminders: [{ ...base, snoozedUntil: dueAt + 3600_000 }] }, auth);
  now.t = dueAt + 5000;
  await dispatchDue(deps);
  assert.equal(sent.length, 0);
  now.t = dueAt + 3600_000 + 1000;
  await dispatchDue(deps);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.body, 'Snoozed reminder is due now');
  await syncReminders(deps, { subscriptionId: id, reminders: [{ ...base, snoozedUntil: dueAt + 3600_000 }] }, auth); // client re-sync
  await dispatchDue(deps);
  assert.equal(sent.length, 1);
});

test('dispatch: survives restart — sent-markers persisted in the file store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-push-'));
  const file = path.join(dir, 'store.json');
  const now = { t: 2_000_000_000_000 };
  const mk = () => {
    const sent: any[] = [];
    const deps: PushDeps = { store: new MemoryStore(file, () => now.t), config: cfg(), now: () => now.t, sender: async (_s, p) => { sent.push(JSON.parse(p)); } };
    return { deps, sent };
  };
  const one = mk();
  const { id, auth } = await registered(one.deps);
  await syncReminders(one.deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'T', dueAt: now.t + 1000, leadMinutes: 0 }] }, auth);
  now.t += 2000;
  await dispatchDue(one.deps);
  assert.equal(one.sent.length, 1);
  const two = mk(); // "process restarted": fresh store instance reading the same file
  await dispatchDue(two.deps);
  assert.equal(two.sent.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('dispatch: 410/404 prune the subscription; transient errors release the claim and retry', async () => {
  const { deps, sent, now, setBehavior } = setup();
  const a = await registered(deps, 1);
  const b = await registered(deps, 2);
  const dueAt = now.t + 1000;
  for (const x of [a, b]) await syncReminders(deps, { subscriptionId: x.id, reminders: [{ id: 'r1', title: 'T', dueAt, leadMinutes: 0 }] }, x.auth);
  now.t = dueAt + 1000;
  setBehavior((endpoint) => (endpoint.endsWith('/1') ? { statusCode: 410 } : { statusCode: 503 }));
  const s1 = await dispatchDue(deps);
  assert.equal(s1.pruned, 1); assert.equal(s1.failed, 1); assert.equal(s1.sent, 0);
  assert.equal(await deps.store.getSubscription(a.id), null);
  assert.ok(await deps.store.getSubscription(b.id));
  setBehavior(() => undefined); // service recovers → same event is retried, exactly once (after the failure backoff)
  assert.equal((await dispatchDue(deps)).backedOff, 1, 'backoff: not retried immediately');
  now.t += 61_000;
  const s2 = await dispatchDue(deps);
  assert.equal(s2.sent, 1);
  assert.equal((await dispatchDue(deps)).sent, 0);
  assert.equal(sent.length, 1);
});

test('dispatch: very stale events (server was down for a long time) are not blasted out', async () => {
  const { deps, sent, now } = setup();
  const { id, auth } = await registered(deps);
  const dueAt = now.t;
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'T', dueAt, leadMinutes: 0 }] }, auth);
  now.t = dueAt + 7 * 3600_000;
  await dispatchDue(deps);
  assert.equal(sent.length, 0);
});

test('payload privacy: PUSH_HIDE_TITLES removes the reminder title from the push', async () => {
  const { deps, sent, now } = setup({ hideTitles: true });
  const { id, auth } = await registered(deps);
  await syncReminders(deps, { subscriptionId: id, reminders: [{ id: 'r1', title: 'Oncology appointment', dueAt: now.t, leadMinutes: 0 }] }, auth);
  await dispatchDue(deps);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent[0].payload).includes('Oncology'));
  const p = buildPayload({ key: 'k', id: 'r1', stage: 'due', at: 1, reminder: { id: 'r1', title: 'Secret', dueAt: 1, leadMinutes: 0 } }, 1, cfg());
  assert.equal(p.title, 'Secret'); // default keeps the title
});

test('sync-reminders: one bad reminder no longer fails the sync; valid ones are stored and skipped count reported', async () => {
  const { deps } = setup();
  const { id, auth } = await registered(deps);
  const r: any = await syncReminders(deps, {
    subscriptionId: id,
    reminders: [
      { id: 'good1', title: 'a', dueAt: 1000 },
      { id: 'bad-year', title: 'b', dueAt: 4_102_444_800_001 },
      { id: '', title: 'c', dueAt: 5 },
      { id: 'bad-lead', title: 'd', dueAt: 5, leadMinutes: -1 },
      null,
      { id: 'good2', title: 'e', dueAt: 2000 },
    ],
  }, auth);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, count: 2, skipped: 4 });
  assert.deepEqual((await deps.store.getReminders(id))!.reminders.map((x) => x.id), ['good1', 'good2']);
  assert.equal(((await syncReminders(deps, { subscriptionId: id, reminders: 'nope' }, auth)) as any).status, 400, 'a non-array payload is still rejected');
  assert.equal(((await syncReminders(deps, { subscriptionId: id, reminders: Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, title: 't', dueAt: 1 })) }, auth)) as any).status, 400);
});
