import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { createApiApp } from '../backend/apiApp';
import { MemoryStore } from '../push-server/store';
import { buildIcsContent, foldIcsLine, icsFilename, isStrictIcsDate } from '../src/lib/icsBuilder';
import { exportIcsCalendar, serverIcsUrl, type IcsExportEnv } from '../src/lib/icalHelper';

const NOW = new Date(Date.UTC(2026, 8, 30, 10, 0, 0));
const line = (ics: string, prefix: string) => ics.split('\r\n').find((l) => l.startsWith(prefix));

/** Minimal RFC 5545 structural validator (what Apple / Google Calendar reject on). */
function assertValidIcs(ics: string) {
  assert.ok(ics.endsWith('\r\n'), 'ends with CRLF');
  assert.ok(!/(^|[^\r])\n/.test(ics), 'no bare LF');
  const raw = ics.split('\r\n');
  raw.pop();
  for (const l of raw) assert.ok(Buffer.byteLength(l) <= 75, `line <= 75 octets: ${l.slice(0, 30)}`);
  const unfolded = ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  assert.equal(unfolded[0], 'BEGIN:VCALENDAR');
  assert.equal(unfolded[unfolded.length - 1], 'END:VCALENDAR');
  const stack: string[] = [];
  for (const l of unfolded) {
    assert.match(l, /^[A-Za-z0-9-]+(;[^:]*)?:/, `content line shape: ${l}`);
    if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
    if (l.startsWith('END:')) assert.equal(stack.pop(), l.slice(4));
  }
  assert.equal(stack.length, 0);
  for (const req of ['VERSION:2.0', 'PRODID:', 'UID:', 'DTSTAMP:', 'DTSTART', 'SUMMARY:']) assert.ok(unfolded.some((l) => l.startsWith(req)), `has ${req}`);
  assert.match(line(ics, 'DTSTAMP:')!, /^DTSTAMP:\d{8}T\d{6}Z$/);
  assert.match(line(ics, 'DTSTART')!, /^DTSTART(;VALUE=DATE:\d{8}|:\d{8}T\d{6})$/);
  return unfolded;
}

test('ics: DD/MM/YYYY and YYYY-MM-DD produce the same event; 12h, 24h and lowercase times', () => {
  const cases: [string, string, string][] = [
    ['15/11/2026', '09:30 AM', '20261115T093000'],
    ['15/11/2026', '09:30 PM', '20261115T213000'],
    ['2026-11-15', '14:30', '20261115T143000'],
    ['15-11-2026', '7:05pm', '20261115T190500'],
    ['15.11.2026', '12:00 AM', '20261115T000000'],
    ['15/11/2026', '12:15 PM', '20261115T121500'],
    ['15 Nov 2026', '9 am', '20261115T090000'],
    ['2026-11-15T10:00:00', '10:00 AM', '20261115T100000'],
    ['15/11/2026', '9:00 AM - 5:00 PM', '20261115T090000'],
  ];
  for (const [date, time, want] of cases) {
    const ics = buildIcsContent({ title: 'x', date, time, now: NOW });
    assertValidIcs(ics);
    assert.equal(line(ics, 'DTSTART'), `DTSTART:${want}`, `${date} ${time}`);
  }
});

test('ics: missing / unparseable time => all-day event with exclusive next-day DTEND (month rollover)', () => {
  for (const time of ['', undefined, '  ', 'later']) {
    const ics = buildIcsContent({ title: 'x', date: '30/11/2026', time, now: NOW });
    assertValidIcs(ics);
    assert.equal(line(ics, 'DTSTART'), 'DTSTART;VALUE=DATE:20261130');
    assert.equal(line(ics, 'DTEND'), 'DTEND;VALUE=DATE:20261201');
  }
  assert.equal(line(buildIcsContent({ title: 'x', date: '31/12/2026', now: NOW }), 'DTEND'), 'DTEND;VALUE=DATE:20270101');
});

test('ics: timed event is one hour and rolls over midnight', () => {
  const ics = buildIcsContent({ title: 'x', date: '31/12/2026', time: '11:30 PM', now: NOW });
  assert.equal(line(ics, 'DTEND'), 'DTEND:20270101T003000');
});

test('ics: escaping, folding, UID, optional VALARM', () => {
  const ics = buildIcsContent({
    title: 'Dr, Smith; check\\up', note: 'Line1\nLine2 ' + 'é'.repeat(80), location: 'Ward 3, "Main" Hospital', recipient: 'Ada',
    date: '15/11/2026', time: '10:00 AM', alarmMinutes: 60, uid: 'abc-123', now: NOW,
  });
  const lines = assertValidIcs(ics);
  assert.ok(lines.includes('SUMMARY:Dr\\, Smith\\; check\\\\up'));
  assert.ok(lines.some((l) => l.startsWith('DESCRIPTION:Line1\\nLine2 é')), 'newline escaped, folded text unfolds intact');
  assert.ok(lines.includes('LOCATION:Ward 3\\, "Main" Hospital'));
  assert.ok(lines.includes('UID:docmind-abc-123@docmind.app'), 'stable UID from reminder id');
  assert.ok(lines.includes('BEGIN:VALARM') && lines.includes('TRIGGER:-PT60M') && lines.includes('ACTION:DISPLAY'));
  assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'long line was folded');
  const noAlarm = buildIcsContent({ title: 'x', date: '15/11/2026', time: '10:00', now: NOW });
  assert.ok(!noAlarm.includes('VALARM'));
  assert.notEqual(line(buildIcsContent({ title: 'x', now: NOW }), 'UID:'), line(buildIcsContent({ title: 'x', now: NOW }), 'UID:'), 'random UIDs differ when no id');
});

test('ics: foldIcsLine never splits a multi-byte character and unfolds losslessly', () => {
  const l = 'SUMMARY:' + '😀é中'.repeat(30);
  const folded = foldIcsLine(l);
  for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75);
  assert.equal(folded.replace(/\r\n /g, ''), l);
});

test('ics: invalid dates are rejected by the strict check (clean error path)', () => {
  for (const d of ['', undefined, '31/02/2026', '99/99/9999', 'banana', '2026-13-45', '15/11/26']) assert.equal(isStrictIcsDate(d as any), false, String(d));
  for (const d of ['15/11/2026', '2026-11-15', '15th November 2026', 'November 15th 2026', 'Sat, 15 Nov 2026']) assert.equal(isStrictIcsDate(d), true, d);
});

test('ics: filename is safe', () => {
  assert.equal(icsFilename('Dr. Visit / 3pm!'), 'Dr_Visit_3pm.ics');
  assert.equal(icsFilename('???'), 'Reminder.ics');
  assert.equal(icsFilename(''), 'Reminder.ics');
});

// ───────────── client helper (injected env) ─────────────

const rem = { id: 'r1', eventTitle: 'Dr Visit', appointmentDate: '15/11/2026', appointmentTime: '09:30 AM', shortNote: 'bring card' };
function fakeEnv(over: Partial<IcsExportEnv> = {}) {
  const calls: string[] = [];
  const saved: { blob?: Blob; filename?: string } = {};
  const shared: { file?: File } = {};
  const env: IcsExportEnv = {
    isMobile: false, online: true,
    saveBlob: (b, f) => { calls.push('save'); saved.blob = b; saved.filename = f; },
    openUrl: (u) => { calls.push('open:' + u); },
    ...over,
  };
  return { env, calls, saved, shared };
}

test('export: desktop saves a Blob download with the generated .ics', async () => {
  const { env, calls, saved } = fakeEnv();
  const r = await exportIcsCalendar(rem, env);
  assert.deepEqual([r.ok, r.ok && r.method], [true, 'download']);
  assert.equal(saved.filename, 'Dr_Visit.ics');
  assert.match(saved.blob!.type, /^text\/calendar/);
  const text = await saved.blob!.text();
  assertValidIcs(text);
  assert.ok(text.includes('DTSTART:20261115T093000'));
  assert.ok(text.includes('TRIGGER:-PT60M'), 'default 60 min reminder alarm');
  assert.deepEqual(calls, ['save']);
});

test('export: mobile shares the .ics file via Web Share; cancel is not an error download', async () => {
  let shared: File | undefined;
  const a = fakeEnv({ isMobile: true, canShareFile: () => true, shareFile: async (f) => { shared = f; } });
  const r = await exportIcsCalendar(rem, a.env);
  assert.deepEqual([r.ok, r.ok && r.method], [true, 'share']);
  assert.equal(shared!.name, 'Dr_Visit.ics');
  assert.deepEqual(a.calls, [], 'no download when share worked');

  const b = fakeEnv({ isMobile: true, canShareFile: () => true, shareFile: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  const c = await exportIcsCalendar(rem, b.env);
  assert.equal(c.ok, false);
  assert.equal(!c.ok && c.reason, 'cancelled');
  assert.deepEqual(b.calls, []);
});

test('export: mobile falls back to download when file sharing unsupported / fails', async () => {
  const a = fakeEnv({ isMobile: true, canShareFile: () => false, shareFile: async () => { throw new Error('nope'); } });
  const r = await exportIcsCalendar(rem, a.env);
  assert.deepEqual([r.ok, r.ok && r.method], [true, 'download']);
  const b = fakeEnv({ isMobile: true, canShareFile: () => true, shareFile: async () => { throw new Error('NotAllowedError'); } });
  const r2 = await exportIcsCalendar(rem, b.env);
  assert.deepEqual([r2.ok, r2.ok && r2.method], [true, 'download']);
});

test('export: blob failure falls back to the server URL (online) or a clear failure (offline)', async () => {
  const boom = () => { throw new Error('blocked'); };
  const on = fakeEnv({ saveBlob: boom });
  const r = await exportIcsCalendar(rem, on.env);
  assert.deepEqual([r.ok, r.ok && r.method], [true, 'server']);
  const url = on.calls[0].replace('open:', '');
  assert.match(url, /^\/api\/download-ics\?/);
  const q = new URL(url, 'http://x').searchParams;
  assert.deepEqual([q.get('title'), q.get('date'), q.get('time')], ['Dr Visit', '15/11/2026', '09:30 AM']);

  const off = fakeEnv({ saveBlob: boom, online: false });
  const r2 = await exportIcsCalendar(rem, off.env);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /Could not export/);
});

test('export: invalid or empty date gives a clean error and nothing is generated', async () => {
  for (const appointmentDate of ['', '31/02/2026', 'banana', undefined]) {
    const { env, calls } = fakeEnv();
    const r = await exportIcsCalendar({ ...rem, appointmentDate }, env);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'invalid-date');
    assert.match(r.message, /valid date/);
    assert.deepEqual(calls, []);
  }
});

test('export: reminder without time is all-day; leadMinutes 0 disables the alarm', async () => {
  const { env, saved } = fakeEnv();
  await exportIcsCalendar({ ...rem, appointmentTime: '', notificationSchedule: { leadMinutes: 0 } }, env);
  const text = await saved.blob!.text();
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261115'));
  assert.ok(!text.includes('VALARM'));
});

test('serverIcsUrl encodes special characters', () => {
  const q = new URL(serverIcsUrl({ eventTitle: 'A&B=C #1 é', appointmentDate: '15/11/2026' }), 'http://x').searchParams;
  assert.equal(q.get('title'), 'A&B=C #1 é');
  assert.equal(q.get('date'), '15/11/2026');
});

// ───────────── server route via the express app ─────────────

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const app = () => createApiApp({ store: new MemoryStore(), config: { publicKey: '', privateKey: '', subject: '', cronSecret: 's' } as any });

test('HTTP /api/download-ics: realistic app params (DD/MM/YYYY + AM/PM, encoded) → valid .ics', async () => {
  await withServer(app(), async (base) => {
    for (const [date, time, want] of [['15/11/2026', '09:30 AM', '20261115T093000'], ['15/11/2026', '09:30 PM', '20261115T213000'], ['2026-11-15', '14:30', '20261115T143000']]) {
      const u = `${base}/api/download-ics?` + new URLSearchParams({ title: 'Dr Visit, Ward 3', note: 'a;b', location: 'City Hospital', recipient: 'Ada', date, time });
      const r = await fetch(u);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') || '', /^text\/calendar; charset=utf-8/);
      assert.match(r.headers.get('content-disposition') || '', /filename="Dr_Visit_Ward_3\.ics"/);
      const body = await r.text();
      const lines = assertValidIcs(body);
      assert.ok(lines.includes(`DTSTART:${want}`), `${date} ${time}`);
      assert.ok(lines.includes('SUMMARY:Dr Visit\\, Ward 3'));
    }
  });
});

test('HTTP /api/download-ics: no time => all-day; invalid date => 400 JSON', async () => {
  await withServer(app(), async (base) => {
    const ok = await fetch(`${base}/api/download-ics?title=x&date=15%2F11%2F2026`);
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes('DTSTART;VALUE=DATE:20261115'));
    const bad = await fetch(`${base}/api/download-ics?title=x&date=31%2F02%2F2026&time=09:30%20AM`);
    assert.equal(bad.status, 400);
    assert.match(bad.headers.get('content-type') || '', /json/);
    assert.equal(((await bad.json()) as any).success, false);
  });
});
