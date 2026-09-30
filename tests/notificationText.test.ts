import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotificationDetail, categoryLabel, cleanText, extractAmount, formatDueDate, formatDueLine, formatDueTime, formatNotification,
  formatNotificationTitle, formatRelative, formatTestNotification, truncateText, MAX_BODY_LINES, MAX_LINE_CHARS,
} from '../src/lib/notificationText';
import { buildSyncPayload, computeDueAt, describeEvent, eventsFor } from '../src/lib/schedule';
import { buildPayload, buildTestPayload, validateReminders, type PushConfig } from '../push-server/core';

const MIN = 60_000;
const UTC = 0; // tzOffsetMinutes for deterministic output
const due = Date.UTC(2026, 9, 15, 9, 30); // Thu 15 Oct 2026 09:30 UTC
const subject = { title: 'Electricity bill', dueAt: due, category: 'Bill', detail: '₦45,000 · Ikeja Electric\nMarch 2026 statement' };

test('due line: date, 12h time without leading zero, relative part', () => {
  assert.equal(formatDueDate(due, UTC), 'Thu, 15 Oct 2026');
  assert.equal(formatDueTime(due, UTC), '9:30 AM');
  assert.equal(formatDueLine(subject, due - 60 * MIN, UTC), 'Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)');
  assert.equal(formatDueTime(Date.UTC(2026, 0, 1, 0, 5), UTC), '12:05 AM');
  assert.equal(formatDueTime(Date.UTC(2026, 0, 1, 12, 0), UTC), '12:00 PM');
  assert.equal(formatDueTime(Date.UTC(2026, 0, 1, 23, 59), UTC), '11:59 PM');
});

test('relative wording: early, on time, overdue, plural/singular', () => {
  assert.equal(formatRelative(due, due - 30 * MIN), 'in 30 minutes');
  assert.equal(formatRelative(due, due - 1 * MIN), 'in 1 minute');
  assert.equal(formatRelative(due, due - 90 * MIN), 'in 1 hour 30 min');
  assert.equal(formatRelative(due, due - 3 * 60 * MIN), 'in 3 hours');
  assert.equal(formatRelative(due, due - 26 * 60 * MIN), 'in 1 day');
  assert.equal(formatRelative(due, due), 'now');
  assert.equal(formatRelative(due, due + 10_000), 'now');
  assert.equal(formatRelative(due, due + 2 * MIN), 'overdue by 2 minutes');
  assert.equal(formatRelative(due, due + 2 * 60 * MIN), 'overdue by 2 hours');
  assert.equal(formatRelative(due, due + 3 * 24 * 60 * MIN), 'overdue by 3 days');
});

test('timezone: same instant reads in the stored user offset (getTimezoneOffset sign)', () => {
  assert.equal(formatDueTime(due, -60), '10:30 AM'); // Lagos UTC+1 => offset -60
  assert.equal(formatDueDate(Date.UTC(2026, 9, 15, 23, 30), -60), 'Fri, 16 Oct 2026'); // crosses midnight locally
  assert.equal(formatDueTime(due, 300), '4:30 AM'); // New York-ish UTC-5
});

test('missing time => date-only line with today/tomorrow/overdue by days', () => {
  const allDay = { title: 'Rent', dueAt: Date.UTC(2026, 9, 15, 0, 0), allDay: true };
  const morning = Date.UTC(2026, 9, 15, 6, 0);
  assert.equal(formatDueLine(allDay, morning, UTC), 'Due: Thu, 15 Oct 2026 (today)');
  assert.equal(formatDueLine(allDay, Date.UTC(2026, 9, 14, 20, 0), UTC), 'Due: Thu, 15 Oct 2026 (tomorrow)');
  assert.equal(formatDueLine(allDay, Date.UTC(2026, 9, 12, 8, 0), UTC), 'Due: Thu, 15 Oct 2026 (in 3 days)');
  assert.equal(formatDueLine(allDay, Date.UTC(2026, 9, 16, 8, 0), UTC), 'Due: Thu, 15 Oct 2026 (overdue by 1 day)');
  assert.ok(!/ at /.test(formatDueLine(allDay, morning, UTC)));
});

test('title: category prefix when specific, none for General/empty, never cut prefix, long titles truncated', () => {
  assert.equal(formatNotificationTitle({ title: 'Electricity', category: 'Bills & Invoices' }), 'Bill: Electricity');
  assert.equal(formatNotificationTitle({ title: 'Dentist', category: 'Dental' }), 'Dental: Dentist');
  assert.equal(formatNotificationTitle({ title: 'Dentist', category: 'General' }), 'Dentist');
  assert.equal(formatNotificationTitle({ title: 'Dentist' }), 'Dentist');
  assert.equal(formatNotificationTitle({ title: '   ' }), 'Reminder');
  const t = formatNotificationTitle({ title: 'A very long reminder title '.repeat(10), category: 'Bill' });
  assert.ok(t.startsWith('Bill: A very long') && t.endsWith('…') && Array.from(t).length <= 64, t);
  assert.equal(categoryLabel('Something Custom And Extremely Long'), 'Something…'); // cut at a word boundary
});

test('body: 2-3 lines — due line + amount/issuer + description; never more than 3', () => {
  const b = formatNotification(subject, 'due', due - 60 * MIN, UTC).body.split('\n');
  assert.deepEqual(b, ['Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)', '₦45,000 · Ikeja Electric', 'March 2026 statement']);
  const many = formatNotification({ ...subject, detail: 'a\nb\nc\nd\ne' }, 'due', due, UTC).body.split('\n');
  assert.equal(many.length, MAX_BODY_LINES);
  const none = formatNotification({ title: 'x', dueAt: due }, 'due', due, UTC).body.split('\n');
  assert.equal(none.length, 1);
});

test('body: snooze re-fire keeps the same format plus a "Snoozed reminder" line (still within 3 lines)', () => {
  const b = formatNotification(subject, 'snooze', due + 5 * MIN, UTC).body.split('\n');
  assert.equal(b[0], 'Due: Thu, 15 Oct 2026 at 9:30 AM (overdue by 5 minutes)');
  assert.equal(b[1], 'Snoozed reminder');
  assert.equal(b.length, 3);
});

test('long text is cut cleanly on a word boundary with an ellipsis, never mid-emoji', () => {
  const long = 'Quarterly service charge for the apartment complex maintenance and security '.repeat(5);
  const line = truncateText(long, MAX_LINE_CHARS);
  assert.ok(Array.from(line).length <= MAX_LINE_CHARS && line.endsWith('…') && !/\s…$/.test(line), line);
  assert.ok(!line.slice(0, -1).endsWith(' '));
  const emoji = truncateText('😀'.repeat(200), 10);
  assert.equal(Array.from(emoji).length, 10);
  assert.ok(!/[\ud800-\udbff]…?$/.test(emoji.slice(0, -1)));
  assert.equal(truncateText('short', 10), 'short');
  const body = formatNotification({ title: 't', dueAt: due, detail: long + '\n' + long }, 'due', due, UTC).body.split('\n');
  assert.ok(body.every((l) => Array.from(l).length <= MAX_LINE_CHARS));
});

test('special characters: control chars / newline injection / bidi overrides / HTML are neutralised or kept as plain text', () => {
  assert.equal(cleanText('a\u0000b\u0007c\u202Edef\u200b  \t g'), 'a b c def g');
  const evil = formatNotification({ title: 'Pay <b>"Tom & Jerry"</b>\nFake: line', dueAt: due, detail: 'Issuer\r\nInjected\u0000: yes' }, 'due', due, UTC);
  assert.ok(!evil.title.includes('\n'));
  assert.equal(evil.title, 'Pay <b>"Tom & Jerry"</b> Fake: line'); // plain text: notifications never render HTML
  assert.equal(evil.body.split('\n').length, 3);
  assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(evil.body));
  assert.equal(formatNotification({ title: 'Café 日本語 ₦', dueAt: due }, 'due', due, UTC).title, 'Café 日本語 ₦');
});

test('detail extraction: amount + issuer + description; nothing invented; privacy: fullText is only mined for an amount', () => {
  assert.equal(extractAmount('Total due ₦45,000 by Friday'), '₦45,000');
  assert.equal(extractAmount('pay $1,250.50 now'), '$1,250.50');
  assert.equal(extractAmount('USD 300 outstanding'), 'USD 300');
  assert.equal(extractAmount('no money here 2026'), '');
  assert.equal(buildNotificationDetail({ hospitalName: 'Ikeja Electric', shortNote: 'Pay ₦45,000 for March' }), '₦45,000 · Ikeja Electric\nPay ₦45,000 for March');
  assert.equal(buildNotificationDetail({}), '');
  assert.equal(buildNotificationDetail({ hospitalName: 'City Clinic', shortNote: 'city clinic' }), 'City Clinic');
  const d = buildNotificationDetail({ hospitalName: 'X', fullText: 'Statement… total ₦9,999.00 due' });
  assert.equal(d.split('\n')[0], '₦9,999.00 · X');
  assert.ok(!d.includes('Statement'));
});

test('sync payload carries category/detail/allDay only when useful; server re-sanitises them', () => {
  const now = computeDueAt('29/09/2026', '09:00 AM')!;
  const base = { id: 'a', eventTitle: 'Electricity', appointmentDate: '29/10/2026', appointmentTime: '', category: 'Bills & Invoices', hospitalName: 'Ikeja Electric', diagnosis: '', shortNote: 'Pay ₦45,000' };
  const [r] = buildSyncPayload([base], now);
  assert.equal(r.category, 'Bill');
  assert.equal(r.allDay, true);
  assert.match(r.detail!, /^₦45,000 · Ikeja Electric/);
  const [g] = buildSyncPayload([{ id: 'b', eventTitle: 'x', appointmentDate: '29/10/2026', appointmentTime: '10:00 AM', category: 'General' }], now);
  assert.ok(!('category' in g) && !('detail' in g) && !('allDay' in g));
  const v = validateReminders([{ id: 'a', title: 't', dueAt: 1e12, leadMinutes: 0, category: 'B'.repeat(500), detail: ('line\u0000 '.repeat(100) + '\n').repeat(10), allDay: 'yes' }])!;
  assert.ok((v.reminders[0].category || '').length <= 16);
  assert.ok((v.reminders[0].detail || '').length <= 160 && v.reminders[0].detail!.split('\n').length <= 2);
  assert.ok(!('allDay' in v.reminders[0]));
});

const cfg = { hideTitles: false } as PushConfig;

test('server payload: title/body from the shared formatter for early, due and snooze; tag/eventKey/dueAt kept; privacy mode intact', () => {
  const r = { id: 'r1', title: 'Electricity', dueAt: due, leadMinutes: 60, snoozedUntil: null, category: 'Bill', detail: '₦45,000 · Ikeja Electric' };
  const [lead, dueEv] = eventsFor(r);
  const early = buildPayload(lead, due - 60 * MIN, cfg, UTC);
  assert.equal(early.title, 'Bill: Electricity');
  assert.equal(early.title, formatNotification(r, 'lead', due - 60 * MIN, UTC).title);
  assert.equal(early.body, 'Due: Thu, 15 Oct 2026 at 9:30 AM (in 1 hour)\n₦45,000 · Ikeja Electric');
  assert.equal(early.tag, 'r1');
  assert.equal(early.eventKey, lead.key);
  const onTime = buildPayload(dueEv, due + 5_000, cfg, UTC);
  assert.match(onTime.body, /\(now\)/);
  const overdue = buildPayload(dueEv, due + 20 * MIN, cfg, UTC);
  assert.match(overdue.body, /\(overdue by 20 minutes\)/);
  const [snooze] = eventsFor({ ...r, snoozedUntil: due + 30 * MIN }).filter((e) => e.stage === 'snooze');
  assert.match(buildPayload(snooze, due + 30 * MIN, cfg, UTC).body, /\nSnoozed reminder/);
  const hidden = buildPayload(dueEv, due, { hideTitles: true } as PushConfig, UTC);
  assert.equal(hidden.title, 'DocuMind reminder');
  assert.ok(!hidden.body.includes('Ikeja'));
});

test('in-page describeEvent matches the server payload for the same event and zone', () => {
  const r = { id: 'r1', title: 'Rent', dueAt: due, leadMinutes: 0, snoozedUntil: null, category: 'Legal' };
  const [ev] = eventsFor(r);
  assert.deepEqual(describeEvent(ev, due, UTC), { title: buildPayload(ev, due, cfg, UTC).title, body: buildPayload(ev, due, cfg, UTC).body });
});

test('test notification uses the same shape (title + "Due:" line + confirmation)', () => {
  const t = formatTestNotification(due, UTC);
  assert.equal(t.title, 'Test: DocuMind alert');
  assert.deepEqual(t.body.split('\n'), ['Due: Thu, 15 Oct 2026 at 9:30 AM (now)', 'Alerts are working on this device.']);
  const p = buildTestPayload(due, UTC);
  assert.equal(p.title, t.title);
  assert.equal(p.body, t.body);
  assert.equal(p.reminderId, '');
  assert.ok(p.tag.startsWith('docmind-test-'));
});
