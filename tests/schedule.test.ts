import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyncPayload,
  calendarDaysUntil,
  computeDueAt,
  eligibleEvents,
  eventsFor,
  parseDateParts,
  parseTimeParts,
  type SyncedReminder,
} from '../src/lib/schedule';
import { validateReminders } from '../push-server/core';
import { checkUpcomingAlerts } from '../src/lib/notifications';
import { nextEventDelay, planAlerts, pruneFired, FIRED_RETENTION_MS } from '../src/lib/alertScheduler';
import type { Reminder } from '../src/types';

const MIN = 60_000;

test('parseTimeParts: 12h/24h, midnight/noon, default 08:00', () => {
  assert.deepEqual(parseTimeParts('10:30 AM'), { h: 10, min: 30 });
  assert.deepEqual(parseTimeParts('07:05 pm'), { h: 19, min: 5 });
  assert.deepEqual(parseTimeParts('12:00 AM'), { h: 0, min: 0 });
  assert.deepEqual(parseTimeParts('12:15 PM'), { h: 12, min: 15 });
  assert.deepEqual(parseTimeParts('23:59'), { h: 23, min: 59 });
  assert.deepEqual(parseTimeParts('9 PM'), { h: 21, min: 0 });
  assert.deepEqual(parseTimeParts(''), { h: 8, min: 0 });
  assert.deepEqual(parseTimeParts('25:99'), { h: 8, min: 0 });
  assert.deepEqual(parseTimeParts(undefined), { h: 8, min: 0 });
});

test('parseDateParts: DD/MM/YYYY and YYYY-MM-DD, rejects impossible dates', () => {
  assert.deepEqual(parseDateParts('05/03/2026'), { y: 2026, m: 3, d: 5 });
  assert.deepEqual(parseDateParts('2026-03-05'), { y: 2026, m: 3, d: 5 });
  assert.deepEqual(parseDateParts('5.3.2026'), { y: 2026, m: 3, d: 5 });
  assert.equal(parseDateParts('31/02/2026'), null);
  assert.equal(parseDateParts('29/02/2027'), null);
  assert.deepEqual(parseDateParts('29/02/2028'), { y: 2028, m: 2, d: 29 });
  assert.equal(parseDateParts('garbage'), null);
  assert.equal(parseDateParts(''), null);
});

test('computeDueAt: fixed timezone offset is honoured (Lagos UTC+1 => offset -60)', () => {
  // 10:00 in Lagos == 09:00 UTC
  assert.equal(computeDueAt('29/09/2026', '10:00 AM', -60), Date.UTC(2026, 8, 29, 9, 0));
  // New York EDT (UTC-4 => getTimezoneOffset 240): 10:00 local == 14:00 UTC
  assert.equal(computeDueAt('29/09/2026', '10:00 AM', 240), Date.UTC(2026, 8, 29, 14, 0));
  assert.equal(computeDueAt('nope', '10:00 AM', 0), null);
});

test('computeDueAt: local timezone is DST aware', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    // 2026-03-08 is the US spring-forward day; 10:00 local is EDT (UTC-4)
    assert.equal(computeDueAt('08/03/2026', '10:00 AM'), Date.UTC(2026, 2, 8, 14, 0));
    // A week earlier it is still EST (UTC-5)
    assert.equal(computeDueAt('01/03/2026', '10:00 AM'), Date.UTC(2026, 2, 1, 15, 0));
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});

test('calendarDaysUntil is DST safe (no off-by-one across spring-forward)', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 2, 7, 23, 30); // Sat 7 Mar 23:30 local
    assert.equal(calendarDaysUntil({ y: 2026, m: 3, d: 8 }, now), 1);
    assert.equal(calendarDaysUntil({ y: 2026, m: 3, d: 9 }, now), 2);
    assert.equal(calendarDaysUntil({ y: 2026, m: 3, d: 7 }, now), 0);
    assert.equal(calendarDaysUntil({ y: 2026, m: 3, d: 6 }, now), -1);
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});

const rem = (over: Partial<SyncedReminder> = {}): SyncedReminder => ({ id: 'a', title: 'Dentist', dueAt: 1_000_000 * MIN, leadMinutes: 60, snoozedUntil: null, ...over });

test('eventsFor: lead + due, keys are stable and unique per stage', () => {
  const evs = eventsFor(rem());
  assert.deepEqual(evs.map((e) => e.stage), ['lead', 'due']);
  assert.equal(evs[0].at, rem().dueAt - 60 * MIN);
  assert.equal(evs[1].at, rem().dueAt);
  assert.notEqual(evs[0].key, evs[1].key);
  assert.deepEqual(eventsFor(rem()).map((e) => e.key), evs.map((e) => e.key));
});

test('eventsFor: leadMinutes 0 disables the heads-up; lead is clamped', () => {
  assert.deepEqual(eventsFor(rem({ leadMinutes: 0 })).map((e) => e.stage), ['due']);
  const huge = eventsFor(rem({ leadMinutes: 10 ** 9 }))[0];
  assert.equal(huge.at, rem().dueAt - 7 * 24 * 60 * MIN);
});

test('eventsFor: snooze suppresses earlier events and adds a wake-up event', () => {
  const r = rem();
  const snoozedUntil = r.dueAt + 30 * MIN;
  const evs = eventsFor({ ...r, snoozedUntil });
  assert.deepEqual(evs.map((e) => e.stage), ['snooze']);
  assert.equal(evs[0].at, snoozedUntil);
  // snooze that ends before the heads-up keeps lead and due
  const early = eventsFor({ ...r, snoozedUntil: r.dueAt - 3 * 60 * MIN });
  assert.deepEqual(early.map((e) => e.stage).sort(), ['due', 'lead', 'snooze']);
});

test('changing the due time yields a new key (re-notifies after an edit)', () => {
  const a = eventsFor(rem({ dueAt: 5_000_000 * MIN })).find((e) => e.stage === 'due')!;
  const b = eventsFor(rem({ dueAt: 5_000_100 * MIN })).find((e) => e.stage === 'due')!;
  assert.notEqual(a.key, b.key);
});

test('eligibleEvents: nothing before the lead time, heads-up in window, due at due time', () => {
  const r = rem();
  const opts = { maxLateMs: 6 * 60 * MIN };
  assert.equal(eligibleEvents([r], r.dueAt - 61 * MIN, opts).length, 0);
  assert.deepEqual(eligibleEvents([r], r.dueAt - 59 * MIN, opts).map((e) => e.stage), ['lead']);
  assert.deepEqual(eligibleEvents([r], r.dueAt, opts).map((e) => e.stage), ['due']); // heads-up superseded
  assert.deepEqual(eligibleEvents([r], r.dueAt + 5 * MIN, opts).map((e) => e.stage), ['due']);
});

test('eligibleEvents: stale events beyond maxLate are dropped', () => {
  const r = rem();
  assert.equal(eligibleEvents([r], r.dueAt + 7 * 60 * MIN, { maxLateMs: 6 * 60 * MIN }).length, 0);
});

test('eligibleEvents: snoozed reminder is silent until the snooze ends, then fires once', () => {
  const r = rem({ snoozedUntil: 1_000_000 * MIN - 30 * MIN }); // snoozed until 30 min before due
  const opts = { maxLateMs: 6 * 60 * MIN };
  assert.equal(eligibleEvents([r], r.dueAt - 45 * MIN, opts).length, 0);
  const after = eligibleEvents([r], r.dueAt - 20 * MIN, opts);
  assert.deepEqual(after.map((e) => e.stage), ['snooze']);
});

const uiReminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'r1', eventTitle: 'Pay rent', hospitalName: 'Landlord', patientName: 'U', patientMatch: 'x', diagnosis: 'd',
  appointmentDate: '29/09/2026', appointmentTime: '10:00 AM', shortNote: '', category: 'Bills & Invoices' as any,
  status: 'Confirmed', createdAt: '', isCompleted: false, ...over,
});

test('buildSyncPayload: drops completed/invalid/very old, de-dupes by id, minimal fields only', () => {
  const now = computeDueAt('29/09/2026', '09:00 AM')!;
  const list = buildSyncPayload([
    uiReminder({ id: 'x', eventTitle: 'first' }),
    uiReminder({ id: 'x', eventTitle: 'second' }),
    uiReminder({ id: 'done', isCompleted: true }),
    uiReminder({ id: 'bad', appointmentDate: 'nonsense' }),
    uiReminder({ id: 'old', appointmentDate: '01/01/2020' }),
    uiReminder({ id: 'snz', notificationSchedule: { snoozedUntil: '2026-09-29T12:00:00.000Z' } }),
  ], now);
  assert.deepEqual(list.map((r) => r.id).sort(), ['snz', 'x']);
  assert.equal(list.find((r) => r.id === 'x')!.title, 'second');
  assert.equal(list.find((r) => r.id === 'snz')!.snoozedUntil, Date.parse('2026-09-29T12:00:00.000Z'));
  const allowed = new Set(['allDay', 'category', 'detail', 'dueAt', 'id', 'leadMinutes', 'snoozedUntil', 'title']); // display fields are optional and short
  for (const r of list) for (const k of Object.keys(r)) assert.ok(allowed.has(k), `unexpected synced field ${k}`);
  assert.ok(!('fullText' in list[0]) && !('patientName' in list[0]) && !('hospitalName' in list[0]));
});

test('planAlerts: fires once, never twice, survives a reload (fired map persisted)', () => {
  const due = computeDueAt('29/09/2026', '10:00 AM')!;
  const rs = [uiReminder()];
  const p1 = planAlerts(rs, {}, due + 5_000);
  assert.equal(p1.notifications.length, 1);
  assert.equal(p1.notifications[0].tag, 'r1');
  const p2 = planAlerts(rs, p1.fired, due + 35_000);
  assert.equal(p2.notifications.length, 0);
  const p3 = planAlerts(rs, JSON.parse(JSON.stringify(p2.fired)), due + 60 * MIN);
  assert.equal(p3.notifications.length, 0);
});

test('planAlerts: heads-up then due are two separate notifications, each once', () => {
  const due = computeDueAt('29/09/2026', '10:00 AM')!;
  const rs = [uiReminder()];
  const a = planAlerts(rs, {}, due - 30 * MIN);
  assert.equal(a.notifications.length, 1);
  assert.match(a.notifications[0].body, /^Due: .* \(in 30 minutes\)/);
  const b = planAlerts(rs, a.fired, due - 29 * MIN);
  assert.equal(b.notifications.length, 0);
  const c = planAlerts(rs, b.fired, due + 1000);
  assert.equal(c.notifications.length, 1);
  assert.match(c.notifications[0].body, /^Due: Tue, 29 Sep 2026 at 10:00 AM \(now\)/);
});

test('planAlerts: completed reminder never fires; snooze suppresses; missed alerts fire on reopen', () => {
  const due = computeDueAt('29/09/2026', '10:00 AM')!;
  assert.equal(planAlerts([uiReminder({ isCompleted: true })], {}, due + 1000).notifications.length, 0);
  const sn = uiReminder({ notificationSchedule: { snoozedUntil: new Date(due + 60 * MIN).toISOString() } });
  assert.equal(planAlerts([sn], {}, due + 10 * MIN).notifications.length, 0);
  assert.equal(planAlerts([sn], {}, due + 61 * MIN).notifications.length, 1); // snooze end
  // app was closed at due time, reopened 20 minutes later: the missed alert is delivered
  assert.equal(planAlerts([uiReminder()], {}, due + 20 * MIN).notifications.length, 1);
});

test('planAlerts: a burst of missed alerts collapses into one summary notification', () => {
  const due = computeDueAt('29/09/2026', '10:00 AM')!;
  const many = Array.from({ length: 9 }, (_, i) => uiReminder({ id: `m${i}`, eventTitle: `T${i}` }));
  const p = planAlerts(many, {}, due + MIN);
  assert.equal(p.notifications.length, 1);
  assert.equal(p.notifications[0].tag, 'docmind-summary');
  assert.equal(p.newEvents, 9);
  assert.equal(planAlerts(many, p.fired, due + 2 * MIN).notifications.length, 0);
});

test('pruneFired drops entries older than retention', () => {
  const now = 10 * FIRED_RETENTION_MS;
  assert.deepEqual(pruneFired({ a: now - FIRED_RETENTION_MS - 1, b: now - 1000 }, now), { b: now - 1000 });
});

test('nextEventDelay: earliest future event (lead, due or snooze end)', () => {
  const due = computeDueAt('29/09/2026', '10:00 AM')!;
  assert.equal(nextEventDelay([uiReminder()], {}, due - 90 * MIN), 30 * MIN); // lead at due-60
  assert.equal(nextEventDelay([uiReminder()], {}, due - 10 * MIN), 10 * MIN);
  assert.equal(nextEventDelay([uiReminder()], {}, due + 10 * MIN), null);
});

test('checkUpcomingAlerts: day buckets, snooze, completed, overdue', () => {
  const today = new Date();
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const plus = (n: number) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 12); return fmt(d); };
  const rs = [
    uiReminder({ id: 'over', appointmentDate: plus(-2) }),
    uiReminder({ id: 'today', appointmentDate: plus(0) }),
    uiReminder({ id: 'w', appointmentDate: plus(2) }),
    uiReminder({ id: 'i', appointmentDate: plus(6) }),
    uiReminder({ id: 'far', appointmentDate: plus(30) }),
    uiReminder({ id: 'done', appointmentDate: plus(0), isCompleted: true }),
    uiReminder({ id: 'snz', appointmentDate: plus(0), notificationSchedule: { snoozedUntil: new Date(Date.now() + 3600_000).toISOString() } }),
    uiReminder({ id: 'iso', appointmentDate: plus(1).split('/').reverse().join('-') }),
  ];
  const out = checkUpcomingAlerts(rs);
  assert.deepEqual(out.map((a) => [a.reminderId, a.severity]), [
    ['over', 'urgent'], ['today', 'urgent'], ['iso', 'warning'], ['w', 'warning'], ['i', 'info'],
  ]);
});

test('parseTimeParts: am/pm must be attached to the time (word boundary): "12:00 Program" is noon, not midnight', () => {
  assert.deepEqual(parseTimeParts('12:00 Program'), { h: 12, min: 0 });
  assert.deepEqual(parseTimeParts('12:00 Program Overseer'), { h: 12, min: 0 });
  assert.deepEqual(parseTimeParts('7:30 Amendment review'), { h: 7, min: 30 });
  assert.deepEqual(parseTimeParts('6:15 Pmt due'), { h: 6, min: 15 });
  assert.deepEqual(parseTimeParts('8:00 Ampersand'), { h: 8, min: 0 });
  assert.deepEqual(parseTimeParts('Program 12:00'), { h: 12, min: 0 });
  assert.deepEqual(parseTimeParts('1:00 pmx'), { h: 1, min: 0 }, '"pmx" is not a meridiem');
});

test('parseTimeParts: ranges use the FIRST time', () => {
  assert.deepEqual(parseTimeParts('9:00 AM - 5:00 PM'), { h: 9, min: 0 });
  assert.deepEqual(parseTimeParts('9:00-17:00'), { h: 9, min: 0 });
  assert.deepEqual(parseTimeParts('1:30 PM – 3:00 PM'), { h: 13, min: 30 });
  assert.deepEqual(parseTimeParts('11:00 AM to 1:00 PM'), { h: 11, min: 0 });
  assert.deepEqual(parseTimeParts('10:00 to 11:00 PM'), { h: 10, min: 0 }, 'meridiem belongs to the time it is attached to');
  assert.deepEqual(parseTimeParts('9 AM - 5 PM'), { h: 9, min: 0 });
  assert.deepEqual(parseTimeParts('5 PM - 9 PM'), { h: 17, min: 0 });
});

test('parseTimeParts: 12 AM / 12 PM and meridiem spellings', () => {
  assert.deepEqual(parseTimeParts('12:00 AM'), { h: 0, min: 0 });
  assert.deepEqual(parseTimeParts('12:30 am'), { h: 0, min: 30 });
  assert.deepEqual(parseTimeParts('12:00 PM'), { h: 12, min: 0 });
  assert.deepEqual(parseTimeParts('12:45pm'), { h: 12, min: 45 });
  assert.deepEqual(parseTimeParts('12 AM'), { h: 0, min: 0 });
  assert.deepEqual(parseTimeParts('12 pm'), { h: 12, min: 0 });
  assert.deepEqual(parseTimeParts('12am'), { h: 0, min: 0 });
  assert.deepEqual(parseTimeParts('1:05 P.M.'), { h: 13, min: 5 });
  assert.deepEqual(parseTimeParts('11:59 a.m.'), { h: 11, min: 59 });
  assert.deepEqual(parseTimeParts('7:05pm'), { h: 19, min: 5 });
  assert.deepEqual(parseTimeParts('at 9pm sharp'), { h: 21, min: 0 });
  assert.deepEqual(parseTimeParts('Tuesday 3 PM'), { h: 15, min: 0 });
  assert.deepEqual(parseTimeParts('13:00 PM'), { h: 13, min: 0 }, '24h value with a stray PM stays 13:00');
  assert.deepEqual(parseTimeParts('0:30 AM'), { h: 0, min: 30 });
});

test('computeDueAt uses the fixed parser (no accidental 00:00 / 21:00)', () => {
  assert.equal(computeDueAt('29/09/2026', '12:00 Program', 0), Date.UTC(2026, 8, 29, 12, 0));
  assert.equal(computeDueAt('29/09/2026', '9:00 AM - 5:00 PM', 0), Date.UTC(2026, 8, 29, 9, 0));
});

test('buildSyncPayload: only sends what the server accepts (year <= 2100); out-of-range items are dropped, not the whole list', () => {
  const now = computeDueAt('29/09/2026', '09:00 AM')!;
  assert.ok(computeDueAt('01/01/2150', '09:00 AM')! > 4_102_444_800_000, 'precondition: parser itself still allows 2150');
  const list = buildSyncPayload([
    uiReminder({ id: 'ok' }),
    uiReminder({ id: 'far', appointmentDate: '01/01/2150' }),
    uiReminder({ id: 'edge', appointmentDate: '31/12/2099' }),
    uiReminder({ id: 'snz-far', notificationSchedule: { snoozedUntil: '2500-01-01T00:00:00.000Z' } }),
    uiReminder({ id: 'x'.repeat(101) }),
  ], now);
  assert.deepEqual(list.map((r) => r.id).sort(), ['edge', 'ok', 'snz-far']);
  assert.equal(list.find((r) => r.id === 'snz-far')!.snoozedUntil, null);
  // every item passes the server's validator unchanged
  const v = validateReminders(list)!;
  assert.equal(v.skipped, 0); assert.equal(v.reminders.length, list.length);
});
