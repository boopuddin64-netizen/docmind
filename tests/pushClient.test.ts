import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncRemindersDetailed } from '../src/lib/pushClient';
import { validateReminders } from '../push-server/core';
import { computeDueAt } from '../src/lib/schedule';

const KEY = 'docmind_push_sub_v1';
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
};
beforeEach(() => { mem.clear(); mem.set(KEY, JSON.stringify({ subscriptionId: 'a'.repeat(32), token: 'tok', endpoint: 'https://fcm.googleapis.com/x' })); });

const rem = (id: string, date: string) => ({
  id, eventTitle: id, appointmentDate: date, appointmentTime: '09:00 AM', hospitalName: '', patientName: '', diagnosis: '', shortNote: '', fullText: '',
  accuracy: 1, category: 'General', status: 'Confirmed', createdAt: '', isCompleted: false,
}) as any;
const res = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as any;
const future = () => `15/06/${new Date().getFullYear() + 1}`;
const opts = (fetchImpl: any, logs: unknown[][] = []) => ({ fetchImpl, retryDelaysMs: [1, 1], log: (...a: unknown[]) => void logs.push(a) });

test('client sync: retries transient failures (5xx/429/network) then succeeds', async () => {
  const seq = [() => res(503), () => { throw new TypeError('network'); }, () => res(200, { skipped: 0 })];
  let i = 0; const logs: unknown[][] = [];
  const out = await syncRemindersDetailed([rem('a', future())], opts(async () => seq[i++](), logs));
  assert.equal(out.ok, true); assert.equal(i, 3);
  assert.ok(logs.length >= 2, 'failed attempts are logged, not ignored');
});

test('client sync: gives up after the retries and reports failure (logged)', async () => {
  let n = 0; const logs: unknown[][] = [];
  const out = await syncRemindersDetailed([rem('a', future())], opts(async () => (n++, res(500)), logs));
  assert.equal(out.ok, false); assert.equal(n, 3);
  assert.ok(logs.some((l) => String(l[0]).includes('500')));
});

test('client sync: 400 is not retried; 401 clears local subscription state', async () => {
  let n = 0;
  assert.equal((await syncRemindersDetailed([rem('a', future())], opts(async () => (n++, res(400))))).ok, false);
  assert.equal(n, 1);
  n = 0;
  const out = await syncRemindersDetailed([rem('a', future())], opts(async () => (n++, res(401))));
  assert.equal(out.ok, false); assert.equal(n, 1); assert.equal(mem.has(KEY), false);
});

test('client sync: surfaces the server\'s skipped count; payload never contains items the server would reject', async () => {
  let sent: any; const logs: unknown[][] = [];
  const out = await syncRemindersDetailed([rem('ok', future()), rem('far', '01/01/2150')], opts(async (_u: string, init: any) => { sent = JSON.parse(init.body); return res(200, { skipped: 2 }); }, logs));
  assert.equal(out.ok, true); assert.equal(out.skipped, 2);
  assert.deepEqual(sent.reminders.map((r: any) => r.id), ['ok']);
  assert.equal(validateReminders(sent.reminders)!.skipped, 0);
  assert.ok(logs.some((l) => String(l[0]).includes('skipped 2')));
  assert.ok(computeDueAt('01/01/2150', '09:00 AM')! > 4_102_444_800_000);
});

test('client sync: no stored subscription => no request', async () => {
  mem.clear(); let n = 0;
  assert.equal((await syncRemindersDetailed([], opts(async () => (n++, res(200))))).ok, false);
  assert.equal(n, 0);
});
