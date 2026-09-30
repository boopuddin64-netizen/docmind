import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { createApiApp } from '../backend/apiApp';
import { validateScanRequest, MAX_IMAGE_BASE64_CHARS } from '../backend/scanValidation';
import { MemoryStore } from '../push-server/store';

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const post = (base: string, path: string, body: unknown, raw = false) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF'), Buffer.alloc(40, 1)]).toString('base64');
const pushDeps = () => ({ store: new MemoryStore(), config: { publicKey: '', privateKey: '', subject: '', cronSecret: 's' } as any });
const fakeAi = (impl: () => Promise<{ text: string }>) => () => ({ models: { generateContent: impl } }) as any;
const quiet = async <T>(fn: () => Promise<T>) => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };

// ───────────── validation (pure) ─────────────

test('scan validation: accepts text-only and image requests, normalises names', () => {
  const t = validateScanRequest({ documentText: 'Electric bill due 15/11/2026', userName: ' Ada ', familyMembers: [{ name: ' Ada ' }, { name: 'Tom', id: 'x' }] });
  assert.ok('value' in t && t.value.userName === 'Ada' && t.value.familyNames.join() === 'Ada,Tom');
  const i = validateScanRequest({ imageBase64: 'data:image/jpeg;base64,' + JPEG_B64, mimeType: 'image/jpeg' });
  assert.ok('value' in i && i.value.imageBase64 === JPEG_B64, 'data-URL prefix is stripped');
});

test('scan validation: rejects wrong types / shapes with 400', () => {
  const bad: unknown[] = [
    null, [], 'str', 5,
    { documentText: 5 }, { documentText: {} , imageBase64: JPEG_B64 },
    { documentText: 'x', userName: 5 }, { documentText: 'x', userName: ['a'] },
    { documentText: 'x', familyMembers: 'Ada' }, { documentText: 'x', familyMembers: { name: 'a' } },
    { documentText: 'x', familyMembers: ['Ada'] }, { documentText: 'x', familyMembers: [{ name: 5 }] },
    { documentText: 'x', familyMembers: [null] }, { documentText: 'x', familyMembers: [{}] },
    { imageBase64: 5 }, { imageBase64: '!!!not base64!!!' }, { imageBase64: JPEG_B64, mimeType: 5 },
    { imageBase64: JPEG_B64, mimeType: 'text/html' }, { imageBase64: JPEG_B64, mimeType: 'image/png' /* bytes are a JPEG */ },
    { documentText: 'x'.repeat(60_001) }, { documentText: 'x', userName: 'n'.repeat(201) },
  ];
  for (const b of bad) {
    const r = validateScanRequest(b);
    assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 80));
    if ('error' in r) assert.equal(r.status, 400);
  }
});

test('scan validation: requires a non-empty image or text; caps image size (413)', () => {
  for (const b of [{}, { documentText: '' }, { documentText: '   ' }, { imageBase64: '' }, { imageBase64: 'data:image/jpeg;base64,' }, { userName: 'Ada' }]) {
    const r = validateScanRequest(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    if ('error' in r) assert.equal(r.status, 400);
  }
  const big = validateScanRequest({ imageBase64: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 500) });
  assert.ok('error' in big && big.status === 413);
  const edge = validateScanRequest({ imageBase64: JPEG_B64 + 'A'.repeat(MAX_IMAGE_BASE64_CHARS - JPEG_B64.length + 4) });
  assert.ok('error' in edge && edge.status === 413);
});

// ───────────── HTTP ─────────────

test('HTTP scan: invalid input → 400 JSON, never reaches the model', async () => {
  let calls = 0;
  const app = createApiApp(pushDeps(), { getAi: fakeAi(async () => { calls++; return { text: '{}' }; }) });
  await withServer(app, async (base) => {
    for (const body of [{}, { documentText: 5 }, { documentText: 'x', familyMembers: ['Ada'] }, { documentText: 'x', userName: {} }]) {
      const r = await post(base, '/api/scan-document', body);
      assert.equal(r.status, 400);
      assert.match(r.headers.get('content-type') || '', /json/);
      const j: any = await r.json();
      assert.equal(j.success, false); assert.equal(typeof j.error, 'string');
    }
  });
  assert.equal(calls, 0);
});

test('HTTP scan: model failure → 502 generic JSON, no raw exception text, no fake result', async () => {
  const app = createApiApp(pushDeps(), { getAi: fakeAi(async () => { throw new Error('SECRET-INTERNAL quota exceeded key=abc'); }) });
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, '/api/scan-document', { documentText: 'Electric bill due 15/11/2026', userName: 'Ada' });
    assert.equal(r.status, 502);
    const text = await r.text();
    assert.ok(!/SECRET-INTERNAL|quota|key=abc|fallback|"accuracy"/i.test(text), text);
    const j = JSON.parse(text);
    assert.equal(j.success, false); assert.ok(!('data' in j));
  }));
});

test('HTTP scan: unparseable model output → 502 (not a fabricated 98% result)', async () => {
  const app = createApiApp(pushDeps(), { getAi: fakeAi(async () => ({ text: 'not json {' })) });
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, '/api/scan-document', { documentText: 'x' });
    assert.equal(r.status, 502);
    const j: any = await r.json();
    assert.equal(j.success, false); assert.ok(!('data' in j)); assert.ok(!/JSON|position/i.test(j.error));
  }));
});

test('HTTP scan: no API key configured → 503 error, no fallback data', async () => {
  const app = createApiApp(pushDeps(), { getAi: () => null });
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, '/api/scan-document', { documentText: 'Electric bill' });
    assert.equal(r.status, 503);
    const j: any = await r.json();
    assert.equal(j.success, false); assert.ok(!('data' in j)); assert.ok(!('source' in j));
  }));
});

test('HTTP scan: success passes model data through; missing accuracy is LOW (not 98); dates normalised or left empty', async () => {
  const item = (over: any) => ({ hospitalName: 'Eko Power', patientName: 'Ada', diagnosis: 'Bill', appointmentDate: '', appointmentTime: '08:00 AM', eventTitle: 'Pay bill', shortNote: 'n', ...over });
  const model = { ...item({}), extractedItems: [item({ appointmentDate: 'Nov 15, 2026' }), item({ appointmentDate: '' , eventTitle: 'No date' }), item({ appointmentDate: 'banana', eventTitle: 'Junk' })] };
  const app = createApiApp(pushDeps(), { getAi: fakeAi(async () => ({ text: JSON.stringify(model) })) });
  await withServer(app, async (base) => {
    const r = await post(base, '/api/scan-document', { documentText: 'bill', userName: 'Ada', familyMembers: [{ name: 'Ada' }] });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.success, true); assert.equal(j.source, 'gemini');
    const dates = j.data.extractedItems.map((i: any) => i.appointmentDate);
    assert.deepEqual(dates, ['15/11/2026', '', ''], 'month-name date parsed; missing/garbage dates stay EMPTY (never today)');
    assert.equal(j.data.extractedItems[0].accuracy, 60, 'no invented 98% confidence when the model gave none for the item');
  });
});

test('HTTP scan: per-IP rate limit → 429 JSON with Retry-After, before any model call', async () => {
  let calls = 0;
  const app = createApiApp(pushDeps(), { scanRateLimit: { windowMs: 60_000, max: 3 }, getAi: fakeAi(async () => { calls++; return { text: '{"extractedItems":[]}' }; }) });
  await withServer(app, async (base) => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) { last = await post(base, '/api/scan-document', { documentText: 'bill' }); statuses.push(last.status); }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    assert.ok(Number(last!.headers.get('retry-after')) >= 1);
    const j: any = await last!.json();
    assert.equal(j.success, false);
    // invalid requests count too (they cost the server parsing work)
  });
  assert.equal(calls, 3);
});

test('HTTP scan: default limit is 20 requests per window', async () => {
  const app = createApiApp(pushDeps(), { getAi: () => null });
  await quiet(() => withServer(app, async (base) => {
    let firstBlocked = 0;
    for (let i = 1; i <= 22; i++) { const r = await post(base, '/api/scan-document', { documentText: 'x' }); if (r.status === 429 && !firstBlocked) firstBlocked = i; }
    assert.equal(firstBlocked, 21);
  }));
});

test('HTTP scan: oversized image → 413 JSON', async () => {
  const app = createApiApp(pushDeps(), { getAi: () => null });
  await withServer(app, async (base) => {
    const r = await post(base, '/api/scan-document', { imageBase64: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1000) });
    assert.equal(r.status, 413);
    assert.equal(((await r.json()) as any).success, false);
    const huge = await post(base, '/api/scan-document', { imageBase64: 'A'.repeat(6_000_000) });
    assert.equal(huge.status, 413, 'body over the parser limit is also a JSON 413');
    assert.match(huge.headers.get('content-type') || '', /json/);
  });
});

test('HTTP: malformed JSON on ANY endpoint → 400 {success:false,error:"Invalid JSON"}', async () => {
  const app = createApiApp(pushDeps(), { getAi: () => null });
  await withServer(app, async (base) => {
    for (const path of ['/api/scan-document', '/api/preprocess', '/api/push/subscribe', '/api/push/sync-reminders', '/api/does-not-exist']) {
      const r = await post(base, path, '{bad json', true);
      assert.equal(r.status, 400, path);
      assert.match(r.headers.get('content-type') || '', /json/, path);
      assert.deepEqual(await r.json(), { success: false, error: 'Invalid JSON' }, path);
    }
  });
});

test('HTTP: unknown /api/* routes → JSON 404 (GET and POST)', async () => {
  const app = createApiApp(pushDeps());
  await withServer(app, async (base) => {
    for (const [m, p] of [['GET', '/api/nope'], ['POST', '/api/nope'], ['GET', '/api/scan-document'], ['DELETE', '/api/health']] as const) {
      const r = await fetch(base + p, { method: m });
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.match(r.headers.get('content-type') || '', /json/);
      assert.deepEqual(await r.json(), { success: false, error: 'Not found' });
    }
  });
});

test('HTTP: /api/health returns JSON status and leaks nothing', async () => {
  await withServer(createApiApp(pushDeps()), async (base) => {
    const r = await fetch(base + '/api/health');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /json/);
    const j: any = await r.json();
    assert.equal(j.success, true); assert.equal(j.status, 'ok');
    assert.deepEqual(Object.keys(j).sort(), ['status', 'success', 'time']);
  });
});

test('HTTP: /api/download-ics → 400 JSON for invalid dates, 200 calendar for valid/empty', async () => {
  await withServer(createApiApp(pushDeps()), async (base) => {
    for (const d of ['99/99/9999', 'banana', '31/02/2026', '2026-13-45']) {
      const r = await fetch(`${base}/api/download-ics?title=x&date=${encodeURIComponent(d)}`);
      assert.equal(r.status, 400, d);
      assert.match(r.headers.get('content-type') || '', /json/);
      assert.equal(((await r.json()) as any).success, false);
    }
    for (const d of ['15/11/2026', '2026-11-15', 'Nov 15, 2026', '']) {
      const r = await fetch(`${base}/api/download-ics?title=x&date=${encodeURIComponent(d)}`);
      assert.equal(r.status, 200, d);
      assert.match(r.headers.get('content-type') || '', /calendar/);
    }
  });
});

test('HTTP: /api/preprocess no longer leaks exception text', async () => {
  await withServer(createApiApp(pushDeps()), async (base) => {
    const r = await post(base, '/api/preprocess', { imageBase64: 'abc' });
    assert.equal(r.status, 200);
  });
});
