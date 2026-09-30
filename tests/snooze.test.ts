import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNOOZE_OPTIONS, applySnooze, isSnoozeMinutes, snoozeLabel, snoozeUntilMs } from '../src/lib/snooze';
import { buildSyncPayload, eligibleEvents } from '../src/lib/schedule';
import { planAlerts } from '../src/lib/alertScheduler';
import { subscribe, syncReminders, dispatchDue, type PushConfig, type PushDeps, type PushSender } from '../push-server/core';
import { MemoryStore } from '../push-server/store';

const MIN = 60_000;
const EXPECTED = [5, 10, 30, 60, 240, 1440];

test('snooze: exactly six options, in order, with clear labels', () => {
  assert.deepEqual(SNOOZE_OPTIONS.map((o) => o.minutes), EXPECTED);
  assert.deepEqual(SNOOZE_OPTIONS.map((o) => o.label), ['5 minutes', '10 minutes', '30 minutes', '1 hour', '4 hours', '24 hours']);
  assert.deepEqual(SNOOZE_OPTIONS.map((o) => o.short), ['5 min', '10 min', '30 min', '1 hour', '4 hours', '24 hours']);
  assert.equal(snoozeLabel(60), '1 hour');
});

test('snooze: anything other than the six durations is rejected', () => {
  for (const bad of [0, 1, 15, 45, 120, 2880, -5, NaN, Infinity, '5', null, undefined]) {
    assert.equal(isSnoozeMinutes(bad), false, String(bad));
    assert.equal(snoozeUntilMs(1000, bad as number), null);
  }
  assert.equal(applySnooze([{ id: 'a' }], 'a', 15, 0), null);
  assert.equal(applySnooze([{ id: 'a' }], 'missing', 5, 0), null);
});

const ui = (over: any = {}) => ({
  id: 'r1', eventTitle: 'Dentist', appointmentDate: '2030-01-15', appointmentTime: '09:00 AM', hospitalName: '', patientName: '', diagnosis: '',
  shortNote: '', fullText: '', accuracy: 1, category: 'General', status: 'Confirmed', createdAt: '', isCompleted: false, ...over,
}) as any;

for (const minutes of EXPECTED) {
  test(`snooze ${minutes} min: sets snoozedUntil exactly ${minutes} min ahead and leaves other reminders alone`, () => {
    const now = Date.parse('2030-01-15T08:00:00Z');
    const list = [ui(), ui({ id: 'r2' })];
    const out = applySnooze(list, 'r1', minutes, now)!;
    assert.equal(Date.parse(out[0].notificationSchedule.snoozedUntil), now + minutes * MIN);
    assert.equal(out[1], list[1]);
    assert.equal(list[0].notificationSchedule, undefined, 'input is not mutated');
    // it is what gets synced to the push dispatcher
    const synced = buildSyncPayload(out, now).find((r) => r.id === 'r1')!;
    assert.equal(synced.snoozedUntil, now + minutes * MIN);
  });
}

test('snooze: an overdue reminder (>24h late) with an active snooze is still synced so the wake-up reaches the server', () => {
  const now = Date.parse('2030-06-01T08:00:00Z');
  const old = ui({ appointmentDate: '2030-01-15' });
  assert.equal(buildSyncPayload([old], now).length, 0, 'plain long-overdue reminders are dropped');
  const snoozed = applySnooze([old], 'r1', 240, now)!;
  assert.equal(buildSyncPayload(snoozed, now).length, 1);
});

// ── re-fire: the closed-app alert comes back after the chosen delay ──
const cfg: PushConfig = {
  publicKey: 'BPubKeyPubKeyPubKeyPubKeyPubKeyPubKey', privateKey: 'priv', subject: 'mailto:t@example.com', cronSecret: 's', hideTitles: false,
  maxLateMs: 6 * 3600_000, allowedHosts: [], allowLocalTestEndpoints: false, maxSubscriptions: 100, sendTimeoutMs: 8000, dispatchBudgetMs: 35_000,
  dispatchConcurrency: 4, claimLeaseSeconds: 180,
};
const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/snooze',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
};

for (const minutes of EXPECTED) {
  test(`re-fire: closed-app push returns after a ${minutes} min snooze — not before, exactly once, loud options`, async () => {
    const due = Date.parse('2030-01-15T09:00:00');
    const clock = { t: due + 2 * MIN }; // reminder is already due; the user snoozes it now
    const sent: Array<{ payload: any; opts: any }> = [];
    const sender: PushSender = async (_s, payload, opts) => void sent.push({ payload: JSON.parse(payload), opts });
    const deps: PushDeps = { store: new MemoryStore(undefined, () => clock.t), config: cfg, sender, now: () => clock.t };
    const reg: any = await subscribe(deps, { subscription: sub });
    const auth = `Bearer ${reg.body.token}`;
    const id = reg.body.subscriptionId;

    // Reminder was already delivered as "due" before the snooze.
    await syncReminders(deps, { subscriptionId: id, reminders: buildSyncPayload([ui()], clock.t) }, auth);
    await dispatchDue(deps);
    const before = sent.length;
    assert.ok(before >= 1, 'the original due alert fired');

    // User snoozes in the app → the app re-syncs the reminders with snoozedUntil.
    const snoozeStart = clock.t;
    const snoozed = applySnooze([ui()], 'r1', minutes, snoozeStart)!;
    await syncReminders(deps, { subscriptionId: id, reminders: buildSyncPayload(snoozed, clock.t) }, auth);

    clock.t = snoozeStart + minutes * MIN - 1000; // 1 s early
    await dispatchDue(deps);
    assert.equal(sent.length, before, 'nothing while snoozed');

    clock.t = snoozeStart + minutes * MIN + 1000; // 1 s after the snooze ends
    await dispatchDue(deps);
    assert.equal(sent.length, before + 1, 'exactly one wake-up push');
    const wake = sent[sent.length - 1];
    assert.equal(wake.payload.reminderId, 'r1');
    assert.equal(wake.payload.body, 'Snoozed reminder is due now');
    assert.equal(wake.opts.urgency, 'high');
    assert.ok(wake.opts.ttl >= 3600);

    await dispatchDue(deps);
    await syncReminders(deps, { subscriptionId: id, reminders: buildSyncPayload(snoozed, clock.t) }, auth); // periodic re-sync
    await dispatchDue(deps);
    assert.equal(sent.length, before + 1, 'no duplicate after re-sync');
  });
}

test('re-fire: snoozing again replaces the previous snooze (only the latest wake-up fires)', async () => {
  const due = Date.parse('2030-01-15T09:00:00');
  const t0 = due + MIN;
  const first = applySnooze([ui()], 'r1', 5, t0)!;
  const second = applySnooze(first, 'r1', 60, t0 + MIN)!;
  const synced = buildSyncPayload(second, t0 + MIN);
  const stages = (now: number) => eligibleEvents(synced, now, { maxLateMs: 6 * 3600_000 }).filter((e) => e.stage === 'snooze').length;
  assert.equal(stages(t0 + 10 * MIN), 0, 'the 5-min snooze no longer fires');
  assert.equal(stages(t0 + MIN + 61 * MIN), 1);
});

test('re-fire: the open app also alerts again once the snooze ends (in-page scheduler)', () => {
  const due = Date.parse('2030-01-15T09:00:00');
  const t0 = due + MIN;
  const snoozed = applySnooze([ui()], 'r1', 30, t0)!;
  const fired = planAlerts([ui()], {}, t0).fired; // the due alert already fired
  assert.equal(planAlerts(snoozed, fired, t0 + 29 * MIN).notifications.length, 0);
  const after = planAlerts(snoozed, fired, t0 + 31 * MIN);
  assert.equal(after.notifications.length, 1);
  assert.equal(after.notifications[0].body, 'Snoozed reminder is due now');
});
