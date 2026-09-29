/**
 * Storage adapter for the Web Push backend.
 *
 * - MemoryStore: in-process Maps, optionally persisted to a JSON file with atomic (tmp + rename) writes.
 *   Used for local development and tests. NOT suitable for serverless (no shared disk between invocations).
 * - UpstashStore: Upstash Redis over REST (works from Vercel serverless functions). Used in production.
 *
 * The important primitive is `claim(key, leaseSeconds)`: an atomic "set if not exists" that acts as a SHORT LEASE.
 * The dispatcher only sends a notification for whoever wins the claim (no duplicates when two cron invocations
 * overlap). The lease becomes the permanent sent-marker (`markSent`) only after the push service accepted the
 * message; a failed/timed-out send releases it (or it simply expires) so the alert is retried, never lost.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';
import type { SyncedReminder } from '../src/lib/schedule.js';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface StoredSubscription {
  id: string;
  /** SHA-256 hex of the bearer token handed to the client at subscribe time. */
  tokenHash: string;
  subscription: PushSubscriptionJSON;
  createdAt: number;
  userAgent?: string;
}

/** Consecutive-failure bookkeeping used for backoff and for pruning dead subscriptions. */
export interface SubscriptionHealth {
  /** Consecutive failed dispatch attempts (any kind). */
  failures: number;
  /** Consecutive failures caused by the push service rejecting us (HTTP 400/401/403). */
  rejects: number;
  firstFailureAt: number;
  lastFailureAt: number;
  /** No send is attempted before this epoch ms (exponential backoff). */
  nextAttemptAt: number;
  lastStatus?: number | string;
}

export interface StoredReminders {
  reminders: SyncedReminder[];
  tzOffsetMinutes: number;
  updatedAt: number;
}

export interface PushStore {
  putSubscription(sub: StoredSubscription): Promise<void>;
  getSubscription(id: string): Promise<StoredSubscription | null>;
  /** Removes the subscription and its reminders (sent-markers are kept until their TTL so re-subscribing never re-sends). */
  removeSubscription(id: string): Promise<void>;
  listSubscriptionIds(): Promise<string[]>;
  countSubscriptions(): Promise<number>;
  putReminders(id: string, data: StoredReminders): Promise<void>;
  getReminders(id: string): Promise<StoredReminders | null>;
  /** Atomically records `key` as sent. Resolves true only for the single caller that created it. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Turns a claim (a SHORT lease held while the push is being sent) into the permanent "sent" marker.
   * Called only after the push service accepted the message.
   */
  markSent(key: string, ttlSeconds: number): Promise<void>;
  /** Delivery health of a subscription (consecutive failures / backoff). null = healthy. */
  getHealth(id: string): Promise<SubscriptionHealth | null>;
  /** Stores the health record; null clears it. */
  setHealth(id: string, health: SubscriptionHealth | null): Promise<void>;
  /** Un-claims a key (used when the push send failed transiently so a later run can retry). */
  release(key: string): Promise<void>;
}

/** How long a delivered event stays marked as sent (prevents duplicates). */
export const SENT_TTL_SECONDS = 30 * 24 * 3600;
/** Default length of the claim lease taken before a send. Only a successful send makes it permanent. */
export const CLAIM_LEASE_SECONDS = 180;
export const HEALTH_TTL_SECONDS = 30 * 24 * 3600;

// ───────────────────────── Memory / file store ─────────────────────────

interface FileShape {
  subs: Record<string, StoredSubscription>;
  reminders: Record<string, StoredReminders>;
  sent: Record<string, number>; // key -> expiry epoch ms
  health?: Record<string, SubscriptionHealth>;
}

export class MemoryStore implements PushStore {
  private subs = new Map<string, StoredSubscription>();
  private reminders = new Map<string, StoredReminders>();
  private sent = new Map<string, number>();
  private health = new Map<string, SubscriptionHealth>();
  private loading: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string, private readonly clock: () => number = Date.now) {}

  /** The load promise is cached so concurrent first calls all wait for the SAME read (no empty-state race on cold start). */
  private load(): Promise<void> {
    return (this.loading ??= this.readFile());
  }

  private async readFile(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<FileShape>;
      for (const [k, v] of Object.entries(data.subs || {})) this.subs.set(k, v);
      for (const [k, v] of Object.entries(data.reminders || {})) this.reminders.set(k, v);
      for (const [k, v] of Object.entries(data.sent || {})) this.sent.set(k, v);
      for (const [k, v] of Object.entries(data.health || {})) this.health.set(k, v);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') console.warn('[push-store] could not read store file, starting empty:', e?.message);
    }
  }

  private persist(): Promise<void> {
    if (!this.filePath) return Promise.resolve();
    const file = this.filePath;
    // Serialize writes; each write is atomic (write temp file, then rename over the target).
    this.writeChain = this.writeChain.then(async () => {
      const now = this.clock();
      for (const [k, exp] of this.sent) if (exp <= now) this.sent.delete(k);
      const data: FileShape = {
        subs: Object.fromEntries(this.subs),
        reminders: Object.fromEntries(this.reminders),
        sent: Object.fromEntries(this.sent),
        health: Object.fromEntries(this.health),
      };
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(tmp, file);
    }).catch((e) => console.warn('[push-store] persist failed:', e?.message));
    return this.writeChain;
  }

  async putSubscription(sub: StoredSubscription) {
    await this.load();
    this.subs.set(sub.id, sub);
    await this.persist();
  }
  async getSubscription(id: string) {
    await this.load();
    return this.subs.get(id) ?? null;
  }
  async removeSubscription(id: string) {
    await this.load();
    this.subs.delete(id);
    this.reminders.delete(id);
    this.health.delete(id);
    // sent-markers are deliberately kept (they expire via TTL) so re-subscribing never re-sends recent alerts.
    await this.persist();
  }
  async listSubscriptionIds() {
    await this.load();
    return [...this.subs.keys()];
  }
  async countSubscriptions() {
    await this.load();
    return this.subs.size;
  }
  async putReminders(id: string, data: StoredReminders) {
    await this.load();
    this.reminders.set(id, data);
    await this.persist();
  }
  async getReminders(id: string) {
    await this.load();
    return this.reminders.get(id) ?? null;
  }
  async claim(key: string, ttlSeconds: number) {
    await this.load();
    const now = this.clock();
    const exp = this.sent.get(key);
    if (exp !== undefined && exp > now) return false;
    this.sent.set(key, now + ttlSeconds * 1000);
    await this.persist();
    return true;
  }
  async markSent(key: string, ttlSeconds: number) {
    await this.load();
    this.sent.set(key, this.clock() + ttlSeconds * 1000);
    await this.persist();
  }
  async release(key: string) {
    await this.load();
    this.sent.delete(key);
    await this.persist();
  }
  async getHealth(id: string) {
    await this.load();
    return this.health.get(id) ?? null;
  }
  async setHealth(id: string, h: SubscriptionHealth | null) {
    await this.load();
    if (h) this.health.set(id, h); else this.health.delete(id);
    await this.persist();
  }
}

// ───────────────────────── Upstash Redis store ─────────────────────────

const P = 'docmind:push';

export class UpstashStore implements PushStore {
  constructor(private readonly redis: Redis) {}

  async putSubscription(sub: StoredSubscription) {
    await this.redis.set(`${P}:sub:${sub.id}`, JSON.stringify(sub));
    await this.redis.sadd(`${P}:subs`, sub.id);
  }
  async getSubscription(id: string) {
    const raw = await this.redis.get<unknown>(`${P}:sub:${id}`);
    return parse<StoredSubscription>(raw);
  }
  async removeSubscription(id: string) {
    await this.redis.del(`${P}:sub:${id}`, `${P}:rem:${id}`, `${P}:health:${id}`);
    await this.redis.srem(`${P}:subs`, id);
  }
  async listSubscriptionIds() {
    const out: string[] = [];
    let cursor: string | number = 0;
    do {
      const [next, keys] = await this.redis.sscan(`${P}:subs`, cursor, { count: 200 });
      out.push(...keys.map(String));
      cursor = next;
    } while (String(cursor) !== '0');
    return out;
  }
  async countSubscriptions() {
    return this.redis.scard(`${P}:subs`);
  }
  async putReminders(id: string, data: StoredReminders) {
    await this.redis.set(`${P}:rem:${id}`, JSON.stringify(data));
  }
  async getReminders(id: string) {
    return parse<StoredReminders>(await this.redis.get<unknown>(`${P}:rem:${id}`));
  }
  async claim(key: string, ttlSeconds: number) {
    // SET key 1 NX EX ttl  → "OK" for the winner, null for everyone else. Atomic on the Redis side.
    const res = await this.redis.set(`${P}:sent:${key}`, '1', { nx: true, ex: ttlSeconds });
    return res === 'OK';
  }
  async markSent(key: string, ttlSeconds: number) {
    await this.redis.set(`${P}:sent:${key}`, '1', { ex: ttlSeconds }); // overwrite the lease with the long-lived marker
  }
  async release(key: string) {
    await this.redis.del(`${P}:sent:${key}`);
  }
  async getHealth(id: string) {
    return parse<SubscriptionHealth>(await this.redis.get<unknown>(`${P}:health:${id}`));
  }
  async setHealth(id: string, h: SubscriptionHealth | null) {
    if (h) await this.redis.set(`${P}:health:${id}`, JSON.stringify(h), { ex: HEALTH_TTL_SECONDS });
    else await this.redis.del(`${P}:health:${id}`);
  }
}

function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T; // @upstash/redis may auto-deserialize JSON
}

// ───────────────────────── factory ─────────────────────────

export function createStore(env: Record<string, string | undefined> = process.env): PushStore {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(new Redis({ url, token }));
  if (env.VERCEL) {
    console.warn('[push-store] Running on Vercel without UPSTASH_REDIS_REST_URL/TOKEN: using a non-persistent in-memory store. Push will NOT work reliably.');
  }
  return new MemoryStore(env.PUSH_STORE_PATH || (env.VERCEL ? undefined : path.join(process.cwd(), '.data', 'push-store.json')));
}
