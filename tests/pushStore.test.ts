import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, UpstashStore, createStore, type PushStore, type StoredSubscription } from '../push-server/store';

const sub = (id: string): StoredSubscription => ({
  id, tokenHash: 'h', createdAt: 1,
  subscription: { endpoint: `https://x.test/${id}`, keys: { p256dh: 'AAAAAAAAAA', auth: 'BBBBBBBBBB' } },
});

/** Contract every adapter must satisfy. */
async function contract(store: PushStore) {
  await store.putSubscription(sub('a'));
  await store.putSubscription(sub('b'));
  assert.equal(await store.countSubscriptions(), 2);
  assert.deepEqual((await store.listSubscriptionIds()).sort(), ['a', 'b']);
  assert.equal((await store.getSubscription('a'))!.subscription.endpoint, 'https://x.test/a');
  assert.equal(await store.getSubscription('zzz'), null);

  await store.putReminders('a', { reminders: [{ id: 'r', title: 't', dueAt: 5, leadMinutes: 1 }], tzOffsetMinutes: -60, updatedAt: 1 });
  assert.equal((await store.getReminders('a'))!.reminders[0].id, 'r');
  await store.putReminders('a', { reminders: [], tzOffsetMinutes: 0, updatedAt: 2 }); // overwrite, not append
  assert.equal((await store.getReminders('a'))!.reminders.length, 0);

  assert.equal(await store.claim('a|k1', 60), true);
  assert.equal(await store.claim('a|k1', 60), false);
  const race = await Promise.all(Array.from({ length: 20 }, () => store.claim('a|k2', 60)));
  assert.equal(race.filter(Boolean).length, 1, 'exactly one concurrent claim wins');
  await store.release('a|k1');
  assert.equal(await store.claim('a|k1', 60), true);

  await store.removeSubscription('a');
  assert.equal(await store.getSubscription('a'), null);
  assert.equal(await store.getReminders('a'), null);
  assert.deepEqual(await store.listSubscriptionIds(), ['b']);
}

test('MemoryStore (in-memory) satisfies the adapter contract', async () => {
  await contract(new MemoryStore());
});

test('MemoryStore (file-backed) satisfies the contract, persists atomically and reloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-store-'));
  const file = path.join(dir, 'nested', 'store.json');
  await contract(new MemoryStore(file));
  const reloaded = new MemoryStore(file);
  assert.deepEqual(await reloaded.listSubscriptionIds(), ['b']);
  assert.equal(await reloaded.claim('a|k2', 60), false, 'sent marker survives restart');
  const files = await fs.readdir(path.dirname(file));
  assert.deepEqual(files, ['store.json'], 'no leftover temp files');
  assert.equal(((await fs.stat(file)).mode & 0o077), 0, 'store file is private (0600)');
  await fs.rm(dir, { recursive: true, force: true });
});

test('MemoryStore: claim TTL expires', async () => {
  let t = 1_000_000;
  const s = new MemoryStore(undefined, () => t);
  assert.equal(await s.claim('k', 10), true);
  t += 9_000; assert.equal(await s.claim('k', 10), false);
  t += 2_000; assert.equal(await s.claim('k', 10), true);
});

test('MemoryStore: a corrupt store file starts empty instead of crashing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-store-'));
  const file = path.join(dir, 'store.json');
  await fs.writeFile(file, '{not json');
  assert.equal(await new MemoryStore(file).countSubscriptions(), 0);
  await fs.rm(dir, { recursive: true, force: true });
});

/** Minimal in-memory fake of the subset of @upstash/redis used by UpstashStore. */
class FakeRedis {
  kv = new Map<string, any>(); sets = new Map<string, Set<string>>();
  async set(k: string, v: any, o?: { nx?: boolean; ex?: number }) {
    if (o?.nx && this.kv.has(k)) return null;
    this.kv.set(k, v); return 'OK';
  }
  async get(k: string) { const v = this.kv.get(k); return v === undefined ? null : v; }
  async del(...ks: string[]) { let n = 0; for (const k of ks) if (this.kv.delete(k)) n++; return n; }
  async sadd(k: string, m: string) { (this.sets.get(k) ?? this.sets.set(k, new Set()).get(k)!).add(m); return 1; }
  async srem(k: string, m: string) { this.sets.get(k)?.delete(m); return 1; }
  async scard(k: string) { return this.sets.get(k)?.size ?? 0; }
  async sscan(k: string, _c: any) { return ['0', [...(this.sets.get(k) ?? [])]] as [string, string[]]; }
}

test('UpstashStore satisfies the same adapter contract (fake Redis client)', async () => {
  const fake = new FakeRedis();
  await contract(new UpstashStore(fake as any));
  assert.ok([...fake.kv.keys()].every((k) => k.startsWith('docmind:push:')), 'all keys namespaced');
});

test('createStore picks Upstash when env is set (incl. Vercel KV_* aliases), else memory/file', () => {
  assert.ok(createStore({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }) instanceof UpstashStore);
  assert.ok(createStore({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' }) instanceof UpstashStore);
  assert.ok(createStore({ PUSH_STORE_PATH: path.join(os.tmpdir(), 'unused.json') }) instanceof MemoryStore);
});
