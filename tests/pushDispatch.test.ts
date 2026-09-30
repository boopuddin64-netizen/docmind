import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKOFF_MAX_MS,
  PRUNE_AFTER_FAILURES,
  PRUNE_AFTER_REJECTS,
  PRUNE_MIN_FAILURE_SPAN_MS,
  PushTimeoutError,
  backoffMs,
  dispatchDue,
  loadConfig,
  subscribe,
  syncReminders,
  withTimeout,
  type PushConfig,
  type PushDeps,
  type PushSender,
} from '../push-server/core';
import { MemoryStore, SENT_TTL_SECONDS } from '../push-server/store';

const cfg = (over: Partial<PushConfig> = {}): PushConfig => ({
  publicKey: 'BPubKeyPubKeyPubKeyPubKeyPubKeyPubKey', privateKey: 'priv', subject: 'mailto:t@example.com', cronSecret: 's',
  hideTitles: false, maxLateMs: 6 * 3600_000, allowedHosts: [], allowLocalTestEndpoints: false, maxSubscriptions: 1000,
  sendTimeoutMs: 60, dispatchBudgetMs: 35_000, dispatchConcurrency: 10, claimLeaseSeconds: 180, ...over,
});
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: P256DH, auth: AUTH } });

function setup(over: Partial<PushConfig> = {}, sender?: PushSender) {
  const now = { t: 1_800_000_000_000 };
  const calls: string[] = [];
  const defaultSender: PushSender = async (s) => { calls.push(s.endpoint); };
  const deps: PushDeps = {
    store: new MemoryStore(undefined, () => now.t), config: cfg(over), now: () => now.t,
    sender: sender ? async (s, p, o) => { calls.push(s.endpoint); return sender(s, p, o); } : defaultSender,
  };
  return { deps, now, calls };
}

async function register(deps: PushDeps, n: number, dueAt: number, reminderId = 'r1') {
  const r: any = await subscribe(deps, { subscription: sub(n) });
  assert.equal(r.status, 200);
  await syncReminders(deps, { subscriptionId: r.body.subscriptionId, reminders: [{ id: reminderId, title: 'T', dueAt, leadMinutes: 0 }] }, `Bearer ${r.body.token}`);
  return r.body.subscriptionId as string;
}

const never = () => new Promise<void>(() => { /* hung push service */ });

test('withTimeout rejects a hung promise, passes through results/errors, tolerates late settle', async () => {
  await assert.rejects(withTimeout(never(), 20), (e: any) => e instanceof PushTimeoutError);
  assert.equal(await withTimeout(Promise.resolve(5), 20), 5);
  await assert.rejects(withTimeout(Promise.reject(new Error('x')), 20), /x/);
  let late!: (v: void) => void;
  await assert.rejects(withTimeout(new Promise<void>((r) => (late = r)), 10));
  late(); // must not throw / cause unhandled rejection
});

test('hung send: run finishes at the timeout (not stalled); lease blocks overlapping runs; alert retried after lease expiry', async () => {
  let hang = true;
  const { deps, now, calls } = setup({}, () => (hang ? never() : Promise.resolve()));
  const id = await register(deps, 1, now.t + 1000);
  now.t += 2000;

  const t0 = Date.now();
  const s1 = await dispatchDue(deps);
  assert.ok(Date.now() - t0 < 1500, 'a hung send must not stall the run');
  assert.equal(s1.timedOut, 1); assert.equal(s1.failed, 1); assert.equal(s1.sent, 0);
  assert.ok(await deps.store.getSubscription(id), 'a timeout does not prune');

  // still inside the lease: overlapping / repeated cron runs do not double-send
  hang = false;
  now.t += 120_000; // > 60s backoff, < 180s lease
  const s2 = await dispatchDue(deps);
  assert.equal(s2.sent, 0); assert.equal(s2.skippedDuplicates, 1);
  assert.equal(calls.length, 1);

  // lease expired => the alert is NOT lost: retried and delivered
  now.t += 100_000;
  const s3 = await dispatchDue(deps);
  assert.equal(s3.sent, 1);
  assert.equal(calls.length, 2);
  // ...and now permanent
  now.t += 3600_000;
  assert.equal((await dispatchDue(deps)).sent, 0);
  assert.equal(calls.length, 2);
});

test('claim is a short lease; only a successful send makes it permanent (30 days)', async () => {
  const { deps, now } = setup();
  const id = await register(deps, 1, now.t + 1000);
  now.t += 2000;
  const store = deps.store as MemoryStore;
  // observe claim/markSent TTLs
  const ttls: Array<[string, number]> = [];
  const origClaim = store.claim.bind(store), origMark = store.markSent.bind(store);
  store.claim = async (k, ttl) => { ttls.push(['claim', ttl]); return origClaim(k, ttl); };
  store.markSent = async (k, ttl) => { ttls.push(['markSent', ttl]); return origMark(k, ttl); };
  await dispatchDue(deps);
  assert.deepEqual(ttls[0], ['claim', 180]);
  assert.ok(ttls[0][1] >= 120 && ttls[0][1] <= 300, 'lease of a few minutes');
  assert.deepEqual(ttls[1], ['markSent', SENT_TTL_SECONDS]);
  // the sent-marker outlives the lease by far: re-claiming the same event still fails days later
  now.t += 10 * 24 * 3600_000;
  const key = `${id}|r1:${1_800_000_001_000}:due`;
  assert.equal(await store.claim(key, 1), false);
});

test('failed (non-timeout) send releases the lease immediately: retried after backoff, not after the lease', async () => {
  let fail = true;
  const { deps, now, calls } = setup({}, () => (fail ? Promise.reject(Object.assign(new Error('boom'), { statusCode: 503 })) : Promise.resolve()));
  await register(deps, 1, now.t + 1000);
  now.t += 2000;
  assert.equal((await dispatchDue(deps)).failed, 1);
  fail = false;
  now.t += 61_000; // past the 60s backoff, well inside the 180s lease
  assert.equal((await dispatchDue(deps)).sent, 1);
  assert.equal(calls.length, 2);
});

test('overlapping runs with a slow (but finishing) send: exactly one delivery', async () => {
  const { deps, now, calls } = setup({ sendTimeoutMs: 2000 }, () => new Promise<void>((r) => setTimeout(r, 100)));
  await register(deps, 1, now.t + 1000);
  now.t += 2000;
  const runs = await Promise.all([dispatchDue(deps), dispatchDue(deps), dispatchDue(deps)]);
  assert.equal(runs.reduce((n, r) => n + r.sent, 0), 1);
  assert.equal(runs.reduce((n, r) => n + r.skippedDuplicates, 0), 2);
  assert.equal(calls.length, 1);
});

test('worker pool: bounded concurrency, and parallel (not serial) processing', async () => {
  let inFlight = 0, peak = 0;
  const { deps, now } = setup({ dispatchConcurrency: 5, sendTimeoutMs: 1000 }, async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 50));
    inFlight--;
  });
  for (let i = 0; i < 20; i++) await register(deps, i, now.t + 1000);
  now.t += 2000;
  const t0 = Date.now();
  const s = await dispatchDue(deps);
  const took = Date.now() - t0;
  assert.equal(s.sent, 20);
  assert.ok(peak > 1 && peak <= 5, `concurrency capped at 5 (peak ${peak})`);
  assert.ok(took < 20 * 50, `parallel: took ${took}ms, serial would be >= 1000ms`);
});

test('many hung subscriptions: the whole run takes ~ceil(n/concurrency) timeouts, not n timeouts', async () => {
  const { deps, now } = setup({ dispatchConcurrency: 10, sendTimeoutMs: 50 }, never);
  for (let i = 0; i < 30; i++) await register(deps, i, now.t + 1000);
  now.t += 2000;
  const t0 = Date.now();
  const s = await dispatchDue(deps);
  const took = Date.now() - t0;
  assert.equal(s.timedOut, 30);
  assert.ok(took < 30 * 50 / 2, `took ${took}ms (serial would be >= 1500ms)`);
});

test('time budget: no new sends start after the budget; the rest is deferred (not claimed) and delivered by the next run', async () => {
  const { deps, now, calls } = setup({ dispatchConcurrency: 1, dispatchBudgetMs: 150 }, () => new Promise<void>((r) => setTimeout(r, 60)));
  for (let i = 0; i < 10; i++) await register(deps, i, now.t + 1000);
  now.t += 2000;
  const t0 = Date.now();
  const s1 = await dispatchDue(deps);
  assert.ok(Date.now() - t0 < 600, 'stops soon after the budget');
  assert.equal(s1.budgetExceeded, true);
  assert.ok(s1.sent >= 1 && s1.sent < 10);
  assert.equal(s1.sent + s1.deferred, 10);
  // next runs finish the job with zero duplicates
  let total = s1.sent;
  for (let i = 0; i < 10 && total < 10; i++) total += (await dispatchDue(deps)).sent;
  assert.equal(total, 10);
  assert.equal(new Set(calls).size, 10);
  assert.equal(calls.length, 10, 'each subscription got exactly one push');
});

test('404/410 prune immediately (no retry)', async () => {
  for (const statusCode of [404, 410]) {
    const { deps, now } = setup({}, () => Promise.reject({ statusCode }));
    const id = await register(deps, 1, now.t + 1000);
    now.t += 2000;
    const s = await dispatchDue(deps);
    assert.equal(s.pruned, 1); assert.equal(s.failed, 0);
    assert.equal(await deps.store.getSubscription(id), null);
  }
});

test('400/401/403 prune only after consecutive failures, with backoff between attempts', async () => {
  for (const statusCode of [400, 401, 403]) {
    const { deps, now, calls } = setup({}, () => Promise.reject({ statusCode }));
    const id = await register(deps, 1, now.t + 1000);
    now.t += 2000;
    let s = await dispatchDue(deps);
    assert.equal(s.pruned, 0); assert.equal(s.failed, 1);
    const h1 = (await deps.store.getHealth(id))!;
    assert.equal(h1.rejects, 1);
    assert.ok(h1.nextAttemptAt >= now.t + 60_000);
    s = await dispatchDue(deps); // immediately again: backoff
    assert.equal(s.backedOff, 1); assert.equal(calls.length, 1);
    for (let i = 1; i < PRUNE_AFTER_REJECTS; i++) {
      now.t += 31 * 60_000; // beyond max backoff
      s = await dispatchDue(deps);
    }
    assert.equal(s.pruned, 1, `pruned after ${PRUNE_AFTER_REJECTS} consecutive ${statusCode}s`);
    assert.equal(calls.length, PRUNE_AFTER_REJECTS);
    assert.equal(await deps.store.getSubscription(id), null);
    assert.equal(await deps.store.getHealth(id), null, 'health record removed with the subscription');
  }
});

test('a success in between resets the reject streak', async () => {
  let code: number | null = 401;
  const { deps, now } = setup({}, () => (code ? Promise.reject({ statusCode: code }) : Promise.resolve()));
  const id = await register(deps, 1, now.t + 1000);
  await register(deps, 1, now.t + 1000); // same endpoint, idempotent
  now.t += 2000;
  await dispatchDue(deps); now.t += 31 * 60_000;
  await dispatchDue(deps); now.t += 31 * 60_000;
  assert.equal((await deps.store.getHealth(id))!.rejects, 2);
  code = null;
  assert.equal((await dispatchDue(deps)).sent, 1);
  assert.equal(await deps.store.getHealth(id), null);
});

test('other repeated failures (timeouts/5xx) prune only after many failures spanning >= 24h', async () => {
  const { deps, now } = setup({}, () => Promise.reject({ statusCode: 503 }));
  const id = await register(deps, 1, now.t + 1000);
  const step = PRUNE_MIN_FAILURE_SPAN_MS / (PRUNE_AFTER_FAILURES - 1) + 1000; // reaches 24h at the 10th failure
  now.t += 2000;
  let pruned = 0, attempts = 0;
  while (!pruned && attempts < PRUNE_AFTER_FAILURES + 2) {
    // fresh due reminder each round (otherwise the single event would go stale)
    await deps.store.putReminders(id, { reminders: [{ id: `r${attempts}`, title: 'T', dueAt: now.t - 1000, leadMinutes: 0 }], tzOffsetMinutes: 0, updatedAt: now.t });
    pruned += (await dispatchDue(deps)).pruned;
    attempts++;
    now.t += step;
  }
  assert.equal(pruned, 1);
  assert.equal(attempts, PRUNE_AFTER_FAILURES, 'pruned at the 10th failure once 24h have passed');
  assert.equal(await deps.store.getSubscription(id), null);
});

test('many quick failures do NOT prune before 24h (a short outage is not a dead subscription)', async () => {
  const { deps, now } = setup({}, () => Promise.reject({ statusCode: 503 }));
  const id = await register(deps, 1, now.t + 1000);
  now.t += 2000;
  for (let i = 0; i < 15; i++) { await dispatchDue(deps); now.t += BACKOFF_MAX_MS + 1000; }
  assert.ok(await deps.store.getSubscription(id));
  assert.ok((await deps.store.getHealth(id))!.failures >= PRUNE_AFTER_FAILURES);
});

test('backoff grows exponentially and is capped', () => {
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 240_000);
  assert.equal(backoffMs(50), BACKOFF_MAX_MS);
});

test('stored subscription with a now-disallowed endpoint is pruned and never contacted (SSRF defense in depth)', async () => {
  const { deps, now, calls } = setup();
  await deps.store.putSubscription({ id: 'a'.repeat(32), tokenHash: 'h', createdAt: 1, subscription: { endpoint: 'https://169.254.169.254/latest', keys: { p256dh: P256DH, auth: AUTH } } });
  await deps.store.putReminders('a'.repeat(32), { reminders: [{ id: 'r', title: 't', dueAt: now.t - 1000, leadMinutes: 0 }], tzOffsetMinutes: 0, updatedAt: 1 });
  const s = await dispatchDue(deps);
  assert.equal(s.pruned, 1); assert.equal(calls.length, 0);
});

test('loadConfig: new knobs have safe defaults and are clamped; local test endpoints are off by default and never on Vercel', () => {
  const d = loadConfig({});
  assert.equal(d.sendTimeoutMs, 8000);
  assert.ok(d.dispatchBudgetMs <= 45_000 && d.dispatchBudgetMs < 60_000);
  assert.equal(d.allowLocalTestEndpoints, false);
  assert.equal(d.claimLeaseSeconds, 180);
  assert.equal(loadConfig({ PUSH_DISPATCH_BUDGET_MS: '999999' }).dispatchBudgetMs, 45_000);
  assert.equal(loadConfig({ PUSH_CLAIM_LEASE_SECONDS: '99999' }).claimLeaseSeconds, 600);
  assert.equal(loadConfig({ PUSH_ALLOW_LOCAL_TEST_ENDPOINTS: '1' }).allowLocalTestEndpoints, true);
  assert.equal(loadConfig({ PUSH_ALLOW_LOCAL_TEST_ENDPOINTS: '1', VERCEL: '1' }).allowLocalTestEndpoints, false);
  assert.deepEqual(loadConfig({ PUSH_ALLOWED_HOSTS: 'push.example.org, *.corp.example.org, 10.0.0.1, bad host' }).allowedHosts, ['push.example.org', '*.corp.example.org']);
});
