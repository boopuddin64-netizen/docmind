import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleCalendarUrl, buildOutlookLiveUrl, buildOutlookOfficeUrl } from '../src/lib/calendarLinks';
import { buildIcsContent, resolveEventWindow } from '../src/lib/icsBuilder';
import { exportToCalendar, serverIcsUrl, type IcsExportEnv, type ExportableReminder } from '../src/lib/icalHelper';

const params = (url: string) => new URL(url).searchParams;
const line = (ics: string, prefix: string) => ics.split('\r\n').find((l) => l.startsWith(prefix));
const NOW = new Date(Date.UTC(2026, 8, 30, 10, 0, 0));

test('google: timed event => dates start/+1h, ctz, title, details, location', () => {
  const url = buildGoogleCalendarUrl({ title: 'Dentist', note: 'Bring card', location: 'City Clinic', recipient: 'Ada', date: '15/11/2026', time: '09:30 AM', timeZone: 'Africa/Lagos' });
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=Dentist&dates=20261115T093000/20261115T103000'));
  const p = params(url);
  assert.equal(p.get('action'), 'TEMPLATE');
  assert.equal(p.get('text'), 'Dentist');
  assert.equal(p.get('dates'), '20261115T093000/20261115T103000');
  assert.equal(p.get('ctz'), 'Africa/Lagos');
  assert.equal(p.get('location'), 'City Clinic');
  assert.equal(p.get('details'), 'Bring card (For: Ada) - DocuMind Reminder');
});

test('google: all-day => YYYYMMDD/YYYYMMDD+1 (exclusive end), no ctz; month/year rollover', () => {
  for (const [date, want] of [['15/11/2026', '20261115/20261116'], ['30/11/2026', '20261130/20261201'], ['31/12/2026', '20261231/20270101'], ['28/02/2028', '20280228/20280229']]) {
    for (const time of ['', undefined, 'later']) {
      const p = params(buildGoogleCalendarUrl({ title: 'x', date, time, timeZone: 'Europe/London' }));
      assert.equal(p.get('dates'), want, date);
      assert.equal(p.get('ctz'), null);
    }
  }
});

test('google: timed event crossing midnight / year end rolls the end date', () => {
  assert.equal(params(buildGoogleCalendarUrl({ title: 'x', date: '31/12/2026', time: '23:30' })).get('dates'), '20261231T233000/20270101T003000');
});

test('urls: special characters, unicode, newlines, & = # + ? are encoded and round-trip', () => {
  const title = 'Pay "Bill" & co = 50% #1 + more? é 你好 😀';
  const note = 'Line1\nLine2; a,b\\c';
  for (const build of [buildGoogleCalendarUrl, buildOutlookLiveUrl, buildOutlookOfficeUrl]) {
    const url = build({ title, note, location: 'A&B St #5', date: '2026-11-15', time: '10:00', timeZone: 'UTC' });
    assert.ok(!/[ "<>]/.test(url), 'no raw space / quote / angle bracket');
    assert.equal(url.split('#').length, 1, 'no raw #');
    const p = params(url);
    assert.equal(p.get('text') ?? p.get('subject'), title);
    assert.equal(p.get('details') ?? p.get('body'), 'Line1\nLine2; a,b\\c - DocuMind Reminder');
    assert.equal(p.get('location'), 'A&B St #5');
  }
});

test('urls: empty title falls back to "Reminder"; very long text is truncated to keep the URL short', () => {
  assert.equal(params(buildGoogleCalendarUrl({ title: '  ', date: '15/11/2026' })).get('text'), 'Reminder');
  const long = 'x'.repeat(10_000);
  for (const build of [buildGoogleCalendarUrl, buildOutlookLiveUrl]) {
    const url = build({ title: long, note: long, location: long, date: '15/11/2026', time: '10:00', timeZone: 'UTC' });
    assert.ok(url.length < 3500, `url length ${url.length}`);
  }
  const emoji = '😀'.repeat(500);
  const t = params(buildGoogleCalendarUrl({ title: emoji, date: '15/11/2026' })).get('text')!;
  assert.ok(!/[\ud800-\udbff]$/.test(t) && t.endsWith('…'));
});

test('outlook: base URLs and required params', () => {
  const live = buildOutlookLiveUrl({ title: 'T', date: '15/11/2026', time: '10:00' });
  assert.ok(live.startsWith('https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=T&'));
  const office = buildOutlookOfficeUrl({ title: 'T', date: '15/11/2026', time: '10:00' });
  assert.ok(office.startsWith('https://outlook.office.com/calendar/deeplink/compose?'));
  assert.equal(params(live).get('path'), '/calendar/action/compose');
  assert.equal(params(live).get('rru'), 'addevent');
});

test('outlook: all-day => allday=true with YYYY-MM-DD dates', () => {
  const p = params(buildOutlookLiveUrl({ title: 'x', date: '31/12/2026', time: '' }));
  assert.equal(p.get('allday'), 'true');
  assert.equal(p.get('startdt'), '2026-12-31');
  assert.equal(p.get('enddt'), '2026-12-31');
});

function withTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

test('outlook: timed => explicit UTC instants computed from the device timezone (+1h)', () => {
  const at = (tz: string) => {
    const p = params(withTz(tz, () => buildOutlookLiveUrl({ title: 'x', date: '15/11/2026', time: '09:30 AM' })));
    return [p.get('startdt'), p.get('enddt')];
  };
  assert.deepEqual(at('UTC'), ['2026-11-15T09:30:00Z', '2026-11-15T10:30:00Z']);
  assert.deepEqual(at('Africa/Lagos'), ['2026-11-15T08:30:00Z', '2026-11-15T09:30:00Z']); // UTC+1
  assert.deepEqual(at('America/New_York'), ['2026-11-15T14:30:00Z', '2026-11-15T15:30:00Z']); // UTC-5 (standard time)
  assert.deepEqual(at('Asia/Kolkata'), ['2026-11-15T04:00:00Z', '2026-11-15T05:00:00Z']); // UTC+5:30
});

test('outlook: DST — same wall clock time maps to different UTC offsets in summer vs winter', () => {
  const start = (date: string) => withTz('Europe/London', () => params(buildOutlookLiveUrl({ title: 'x', date, time: '12:00' })).get('startdt'));
  assert.equal(start('15/07/2026'), '2026-07-15T11:00:00Z'); // BST
  assert.equal(start('15/12/2026'), '2026-12-15T12:00:00Z'); // GMT
});

test('google/outlook/ics all agree on the same start and end (shared resolver)', () => {
  const cases: [string, string][] = [['15/11/2026', '09:30 AM'], ['2026-11-15', '14:30'], ['31/12/2026', '11:30 PM'], ['15 Nov 2026', '12:00 AM'], ['15/11/2026', ''], ['28/02/2027', '9am']];
  for (const [date, time] of cases) {
    const ics = buildIcsContent({ title: 'x', date, time, now: NOW });
    const g = params(buildGoogleCalendarUrl({ title: 'x', date, time, timeZone: 'UTC' })).get('dates')!;
    const [gs, ge] = g.split('/');
    const icsStart = line(ics, 'DTSTART')!.split(':')[1];
    const icsEnd = line(ics, 'DTEND')!.split(':')[1];
    assert.equal(gs, icsStart, `${date} ${time} start`);
    assert.equal(ge, icsEnd, `${date} ${time} end`);
    const w = resolveEventWindow(date, time, NOW);
    const o = withTz('UTC', () => params(buildOutlookLiveUrl({ title: 'x', date, time })));
    if (w.allDay) assert.equal(o.get('startdt')!.replace(/-/g, ''), icsStart);
    else assert.equal(o.get('startdt')!.replace(/[-:]/g, '').replace('Z', ''), icsStart);
  }
});

// ---- exportToCalendar (picker actions) ------------------------------------------------------------------------------

const rem: ExportableReminder = { id: 'r1', eventTitle: 'Dentist', appointmentDate: '15/11/2026', appointmentTime: '09:30 AM', notificationSchedule: { leadMinutes: 30 } };

function fakeEnv(over: Partial<IcsExportEnv> = {}) {
  const log = { opened: [] as string[], saved: [] as string[], shared: [] as string[] };
  const env: IcsExportEnv = {
    isMobile: true,
    online: true,
    canShareFile: () => true,
    shareFile: async (f) => { log.shared.push(f.name); },
    saveBlob: (_b, name) => { log.saved.push(name); },
    openUrl: (u) => { log.opened.push(u); },
    ...over,
  };
  return { env, log };
}

test('picker: google / outlook / outlook365 open the deep link; offline => toast-able failure, nothing opened', async () => {
  const { env, log } = fakeEnv();
  assert.equal((await exportToCalendar(rem, 'google', env, 'Africa/Lagos')).ok, true);
  assert.equal((await exportToCalendar(rem, 'outlook', env)).ok, true);
  assert.equal((await exportToCalendar(rem, 'outlook365', env)).ok, true);
  assert.match(log.opened[0], /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(log.opened[0], /ctz=Africa%2FLagos|ctz=Africa\/Lagos/);
  assert.match(log.opened[1], /^https:\/\/outlook\.live\.com\//);
  assert.match(log.opened[2], /^https:\/\/outlook\.office\.com\//);
  const off = fakeEnv({ online: false });
  const r = await exportToCalendar(rem, 'google', off.env);
  assert.equal(r.ok, false);
  assert.equal(off.log.opened.length, 0);
  assert.match((r as any).message, /offline/i);
});

test('picker: openUrl throwing is reported, not swallowed', async () => {
  const { env } = fakeEnv({ openUrl: () => { throw new Error('blocked'); } });
  const r = await exportToCalendar(rem, 'outlook', env);
  assert.equal(r.ok, false);
  assert.match((r as any).message, /Could not open Outlook/);
});

test('picker: invalid or missing date is refused for every target', async () => {
  for (const target of ['share', 'apple', 'google', 'outlook', 'outlook365', 'ics'] as const) {
    for (const d of ['', 'banana', '31/02/2026']) {
      const { env, log } = fakeEnv();
      const r = await exportToCalendar({ ...rem, appointmentDate: d }, target, env);
      assert.equal(r.ok, false, `${target} ${d}`);
      assert.equal((r as any).reason, 'invalid-date');
      assert.equal(log.opened.length + log.saved.length + log.shared.length, 0);
    }
  }
});

test('picker: share uses Web Share with the .ics File; unsupported => clear error; cancel => cancelled', async () => {
  const a = fakeEnv();
  const r = await exportToCalendar(rem, 'share', a.env);
  assert.equal(r.ok, true);
  assert.deepEqual(a.log.shared, ['Dentist.ics']);
  const b = fakeEnv({ canShareFile: undefined, shareFile: undefined });
  const rb = await exportToCalendar(rem, 'share', b.env);
  assert.equal(rb.ok, false);
  assert.equal((rb as any).reason, 'unsupported');
  const c = fakeEnv({ canShareFile: () => false });
  assert.equal((await exportToCalendar(rem, 'share', c.env)).ok, false);
  const d = fakeEnv({ shareFile: async () => { const e: any = new Error('x'); e.name = 'AbortError'; throw e; } });
  const rd = await exportToCalendar(rem, 'share', d.env);
  assert.equal(rd.ok, false);
  assert.equal((rd as any).reason, 'cancelled');
});

test('picker: apple opens the https server .ics (text/calendar) with alarm + uid; offline falls back to the on-device file', async () => {
  const a = fakeEnv();
  const r = await exportToCalendar(rem, 'apple', a.env);
  assert.equal(r.ok, true);
  assert.equal(a.log.opened.length, 1);
  const u = new URL(a.log.opened[0], 'https://docmind.test');
  assert.equal(u.pathname, '/api/download-ics');
  assert.equal(u.searchParams.get('alarm'), '30');
  assert.equal(u.searchParams.get('uid'), 'r1');
  assert.ok(!/^webcal:/i.test(a.log.opened[0]));
  const b = fakeEnv({ online: false });
  const rb = await exportToCalendar(rem, 'apple', b.env);
  assert.equal(rb.ok, true);
  assert.equal(b.log.opened.length, 0);
  assert.deepEqual(b.log.shared, ['Dentist.ics']); // share sheet -> Calendar
  assert.match(serverIcsUrl(rem), /^\/api\/download-ics\?/);
});

test('picker: ics always downloads (never opens the share sheet); a failing download is reported', async () => {
  const a = fakeEnv();
  const r = await exportToCalendar(rem, 'ics', a.env);
  assert.equal(r.ok, true);
  assert.deepEqual(a.log.saved, ['Dentist.ics']);
  assert.equal(a.log.shared.length, 0);
  const b = fakeEnv({ saveBlob: () => { throw new Error('nope'); }, openUrl: () => { throw new Error('nope'); } });
  const rb = await exportToCalendar(rem, 'ics', b.env);
  assert.equal(rb.ok, false);
  assert.match((rb as any).message, /Could not export/);
});
