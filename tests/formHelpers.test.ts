import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexibleDate, toDdMmYyyy, validateDateField, validateTimeField } from '../src/lib/dateInput';
import { validateEmail, validateAvatarFile, clamp, FIELD_LIMITS } from '../src/lib/formValidation';
import { normalizeDate, sanitizeAndValidateDocData } from '../src/lib/sanitizer';
import { isStrictIcsDate, isValidIcsDateInput } from '../src/lib/icsBuilder';
import { fitWithin, readScanResponse, ScanError } from '../src/lib/scanClient';
import { RESET_STORAGE_KEYS, resetAppData } from '../src/lib/resetData';

test('dates: numeric and month-name formats parse; garbage / impossible dates are rejected', () => {
  const ok: Record<string, string> = {
    '15/11/2026': '15/11/2026', '5-1-2026': '05/01/2026', '2026-11-15': '15/11/2026', '2026-11-15T10:00:00Z': '15/11/2026',
    'Nov 15, 2026': '15/11/2026', 'November 15 2026': '15/11/2026', '15 Nov 2026': '15/11/2026', '15th November, 2026': '15/11/2026',
    'Sat, 15 Nov 2026': '15/11/2026', 'sept 3, 2027': '03/09/2027', '29/02/2028': '29/02/2028',
  };
  for (const [i, o] of Object.entries(ok)) assert.equal(toDdMmYyyy(i), o, i);
  for (const bad of ['99/99/9999', 'banana', '31/02/2026', '29/02/2027', '', '   ', 'Foo 15, 2026', 'Nov 32, 2026', '15/11', '2026', null, 5, undefined, 'x'.repeat(200)]) {
    assert.equal(parseFlexibleDate(bad as any), null, String(bad));
  }
});

test('date field validation: inline error text on bad input, normalised value on good input', () => {
  assert.deepEqual(validateDateField('Nov 15, 2026'), { ok: true, value: '15/11/2026' });
  for (const bad of ['99/99/9999', 'banana', '']) { const r = validateDateField(bad); assert.equal(r.ok, false); assert.match(r.error!, /date/i); }
  assert.deepEqual(validateDateField('', { required: false }), { ok: true, value: '' });
});

test('time field validation', () => {
  assert.equal(validateTimeField('10:00 AM').value, '10:00 AM');
  assert.equal(validateTimeField('9am').value, '09:00 AM');
  assert.equal(validateTimeField('7:05 pm').value, '07:05 PM');
  assert.equal(validateTimeField('14:30').value, '02:30 PM');
  assert.equal(validateTimeField('12:00 AM').value, '12:00 AM');
  assert.equal(validateTimeField('').value, '08:00 AM');
  for (const bad of ['banana', '25:00', '13:00 PM', '10:99', '0am', '10:00 XM']) assert.equal(validateTimeField(bad).ok, false, bad);
});

test('sanitizer: an unreadable date stays EMPTY (never today / +15 days); month-name dates are understood', () => {
  assert.equal(normalizeDate('').formatted, '');
  assert.equal(normalizeDate('banana').formatted, '');
  assert.equal(normalizeDate('99/99/9999').isValid, false);
  assert.equal(normalizeDate('Nov 15, 2026').formatted, '15/11/2026');
  const s = sanitizeAndValidateDocData({ eventTitle: 'x', appointmentDate: 'nonsense', hospitalName: 'Eko' });
  assert.equal(s.appointmentDate, '');
  assert.equal(s.needsReview, true, 'missing date forces the review step');
});

test('ics: strict date check (export refuses invalid / empty dates)', () => {
  assert.equal(isStrictIcsDate('15/11/2026'), true);
  for (const b of ['99/99/9999', 'banana', '', undefined, '31/02/2026']) assert.equal(isStrictIcsDate(b as any), false, String(b));
  assert.equal(isValidIcsDateInput(''), true, 'server: empty means today');
  assert.equal(isValidIcsDateInput('banana'), false);
});

test('email validation', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com']) assert.equal(validateEmail(ok).ok, true, ok);
  for (const bad of ['', 'banana', 'a@b', 'a@@b.com', 'a b@c.com', '@x.com', 'a@.com', 'a@b..com', 'a@b.c']) assert.equal(validateEmail(bad).ok, false, bad);
  assert.equal(validateEmail('  a@b.com ').value, 'a@b.com');
});

test('avatar file validation rejects non-images and huge files', () => {
  assert.equal(validateAvatarFile({ type: 'image/png', size: 1000 }).ok, true);
  for (const t of ['application/pdf', 'text/plain', '', 'image/svg+xml', 'application/x-msdownload']) assert.equal(validateAvatarFile({ type: t, size: 10 }).ok, false, t);
  assert.equal(validateAvatarFile({ type: 'image/jpeg', size: 9 * 1024 * 1024 }).ok, false);
});

test('clamp caps long text', () => {
  assert.equal(clamp('x'.repeat(5000), FIELD_LIMITS.title).length, FIELD_LIMITS.title);
});

test('client image sizing: longest side capped at 1600, never upscaled', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

const mkRes = (status: number, ctype: string | null, body: unknown, jsonThrows = false) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ctype : null) },
  json: async () => { if (jsonThrows) throw new SyntaxError('Unexpected token'); return body; },
}) as any;

test('client scan response: checks ok + content-type before json(); friendly errors; never a fake result', async () => {
  const data = await readScanResponse(mkRes(200, 'application/json; charset=utf-8', { success: true, data: { eventTitle: 'x' } }));
  assert.equal(data.eventTitle, 'x');
  const cases: Array<[any, RegExp, number]> = [
    [mkRes(413, 'text/plain', 'Request Entity Too Large', true), /too large/i, 413],
    [mkRes(413, 'application/json', { success: false, error: 'x' }), /too large/i, 413],
    [mkRes(429, 'application/json', { success: false, error: 'x' }), /wait/i, 429],
    [mkRes(502, 'text/html', '<html>Bad gateway</html>', true), /network problem/i, 502], // gateway page: infrastructure, not the AI
    [mkRes(502, 'application/json', { success: false, error: 'We could not read this document.' }), /could not read/i, 502],
    [mkRes(200, 'text/html', '<html>', true), /network problem/i, 200], // captive portal / proxy page
    [mkRes(200, 'application/json', null, true), /network problem/i, 200], // cut-off body
    [mkRes(200, 'application/json', { success: false, error: 'nope' }), /nope/, 200],
    [mkRes(200, 'application/json', { success: true }), /did not return/i, 200],
  ];
  for (const [res, re, status] of cases) {
    await assert.rejects(readScanResponse(res), (e: any) => e instanceof ScanError && re.test(e.message) && e.status === status && !/Unexpected token|<html/i.test(e.message));
  }
});

test('Reset App Data: unsubscribes first, then clears dark-mode, notification, fired-alert, push keys and items/profile', async () => {
  const store = new Map<string, string>(RESET_STORAGE_KEYS.map((k) => [k, '1']));
  store.set('unrelated', 'keep');
  const order: string[] = [];
  const storage = { removeItem: (k: string) => { order.push('rm:' + k); store.delete(k); } };
  await resetAppData(async () => { order.push('disable'); }, storage, { clearFiredCache: async () => { order.push('cache'); } });
  assert.equal(order[0], 'disable', 'push is disabled BEFORE local data is cleared');
  for (const k of ['docreminder_items', 'docreminder_profile', 'docreminder_darkmode', 'docreminder_notifications', 'docmind_fired_alerts_v1', 'docmind_push_sub_v1']) {
    assert.ok(!store.has(k), k);
  }
  assert.equal(store.get('unrelated'), 'keep');
  assert.equal(order.at(-1), 'cache');
});

test('Reset App Data still clears everything when unsubscribing fails or hangs', async () => {
  const s1 = new Map<string, string>(RESET_STORAGE_KEYS.map((k) => [k, '1']));
  await resetAppData(async () => { throw new Error('offline'); }, { removeItem: (k) => void s1.delete(k) });
  assert.equal(s1.size, 0);
  const s2 = new Map<string, string>(RESET_STORAGE_KEYS.map((k) => [k, '1']));
  await resetAppData(() => new Promise<void>(() => {}), { removeItem: (k) => void s2.delete(k) }, { timeoutMs: 20 });
  assert.equal(s2.size, 0);
});
