import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { createApiApp } from '../backend/apiApp';
import { MemoryStore } from '../push-server/store';
import { classifyGeminiError, generateWithFallback, GeminiCallError, DEFAULT_SCAN_MODELS, MAX_SCAN_MODELS, parseModelList, resolveScanModels } from '../backend/geminiCall';
import { ScanError, classifyScanFailure, isTransientScanError, readScanResponse, requestScan } from '../src/lib/scanErrors';
import { beginScan, isScanInFlight, resetScanActivity } from '../src/lib/scanActivity';
import { decideFreshness, installSessionFreshness, HIDDEN_REFRESH_AFTER_MS } from '../src/lib/sessionFreshness';

// ───────── helpers ─────────
const api = (status: number, message: string) => Object.assign(new Error(JSON.stringify({ error: { code: status, message } })), { name: 'ApiError', status });
const overloaded = () => api(503, 'This model is currently experiencing high demand.');
const quota = (retry = '13.1s') => api(429, `You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in ${retry}.`);
const ok = { text: JSON.stringify({ hospitalName: 'Eko', patientName: 'Ada', diagnosis: 'Bill', appointmentDate: '15/11/2026', appointmentTime: '08:00 AM', eventTitle: 'Pay', shortNote: '', accuracy: 90, extractedItems: [] }) };
const noSleep = async () => {};
/** A fake Gemini client that plays back one outcome per call and records the model of every call. */
function script(outcomes: Array<'ok' | Error | { text: string } | 'hang'>) {
  const models: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  let i = 0;
  const ai = { models: { generateContent: async (a: any) => {
    models.push(a.model); signals.push(a.config?.abortSignal);
    const o = outcomes[Math.min(i++, outcomes.length - 1)];
    if (o === 'hang') return new Promise<never>(() => {});
    if (o instanceof Error) throw o;
    return o === 'ok' ? ok : o;
  } } } as any;
  return { ai, models, signals };
}
const req = { contents: { parts: [{ text: 'x' }] }, config: { temperature: 0 } };

// ───────── server: error classification ─────────
test('classifyGeminiError: 503 → overloaded, 429 → quota (+ retry delay), 404 → model-missing, 401/403 → auth, 400 → bad-request, fetch failure → network', () => {
  assert.equal(classifyGeminiError(overloaded()).kind, 'overloaded');
  const q = classifyGeminiError(quota('13.162279273s'));
  assert.equal(q.kind, 'quota');
  assert.equal(q.retryAfterMs, 13163);
  assert.equal(classifyGeminiError(api(404, 'models/x is no longer available')).kind, 'model-missing');
  assert.equal(classifyGeminiError(api(403, 'denied')).kind, 'auth');
  assert.equal(classifyGeminiError(api(400, 'API key not valid')).kind, 'auth');
  assert.equal(classifyGeminiError(api(400, 'bad schema')).kind, 'bad-request');
  assert.equal(classifyGeminiError(new TypeError('fetch failed')).kind, 'network');
  assert.equal(classifyGeminiError(new Error('boom')).kind, 'unknown');
});

// ───────── server: retry + fallback ─────────
test('Gemini 503 on the first try is retried on the same model after a short backoff and then succeeds', async () => {
  const s = script([overloaded(), 'ok']);
  const sleeps: number[] = [];
  const r = await generateWithFallback(s.ai, req, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(r.attempts, 2);
  assert.deepEqual(s.models, [DEFAULT_SCAN_MODELS[0], DEFAULT_SCAN_MODELS[0]]);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 900 && sleeps[0] < 1300, `backoff ${sleeps[0]}`);
  assert.equal(r.data.hospitalName, 'Eko');
});

test('a persistently overloaded model falls back to the next model (production log: gemini-3.6-flash 503s)', async () => {
  const s = script([overloaded(), overloaded(), 'ok']);
  const r = await generateWithFallback(s.ai, req, { sleep: noSleep });
  assert.deepEqual(s.models, [DEFAULT_SCAN_MODELS[0], DEFAULT_SCAN_MODELS[0], DEFAULT_SCAN_MODELS[1]]);
  assert.equal(r.model, DEFAULT_SCAN_MODELS[1]);
});

test('429 free-tier quota (per model) skips straight to the next model without waiting', async () => {
  const s = script([quota(), 'ok']);
  const sleeps: number[] = [];
  const r = await generateWithFallback(s.ai, req, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(s.models, [DEFAULT_SCAN_MODELS[0], DEFAULT_SCAN_MODELS[1]]);
  assert.equal(sleeps.length, 0);
  assert.equal(r.attempts, 2);
});

test('a missing / retired model is skipped; auth errors and bad requests stop at once (no pointless fallback)', async () => {
  const miss = script([api(404, 'gone'), 'ok']);
  assert.equal((await generateWithFallback(miss.ai, req, { sleep: noSleep })).model, DEFAULT_SCAN_MODELS[1]);
  const auth = script([api(403, 'denied'), 'ok']);
  const e1: any = await generateWithFallback(auth.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.ok(e1 instanceof GeminiCallError);
  assert.equal(e1.failure, 'auth');
  assert.equal(auth.models.length, 1);
  const bad = script([api(400, 'schema invalid'), 'ok']);
  const e2: any = await generateWithFallback(bad.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.equal(e2.failure, 'failed');
  assert.equal(bad.models.length, 1);
});

test('everything overloaded / out of quota → GeminiCallError "busy" after trying every model', async () => {
  const s = script([overloaded()]);
  const e: any = await generateWithFallback(s.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.ok(e instanceof GeminiCallError);
  assert.equal(e.failure, 'busy');
  assert.equal(e.lastStatus, 503);
  assert.deepEqual([...new Set(s.models)], [...DEFAULT_SCAN_MODELS]);
  const q = script([quota('40s')]);
  const e2: any = await generateWithFallback(q.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.equal(e2.failure, 'busy');
});

test('unusable model output (not JSON / not an object) moves to the next model; if all fail it is "failed", not "busy"', async () => {
  const s = script([{ text: 'not json {' }, { text: '[1,2]' }, 'ok']);
  const r = await generateWithFallback(s.ai, req, { sleep: noSleep });
  assert.equal(r.model, DEFAULT_SCAN_MODELS[2]);
  const all = script([{ text: 'nope' }]);
  const e: any = await generateWithFallback(all.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.equal(e.failure, 'failed');
});

test('a hanging model call is aborted by the per-attempt timeout and the next model is tried; the AbortSignal is passed to the SDK', async () => {
  const s = script(['hang', 'hang', 'ok']);
  const t0 = Date.now();
  const r = await generateWithFallback(s.ai, req, { attemptTimeoutMs: 30, backoffMs: 1, minAttemptMs: 1, budgetMs: 5_000 });
  assert.ok(Date.now() - t0 < 2_000);
  assert.equal(r.model, DEFAULT_SCAN_MODELS[1]);
  assert.ok(s.signals[0] instanceof AbortSignal);
  assert.equal(s.signals[0]!.aborted, true, 'timed-out attempt was aborted');
});

test('the total time budget stops further attempts (function always answers before the platform / client timeout)', async () => {
  let clock = 0;
  const s = script([overloaded()]);
  const e: any = await generateWithFallback(s.ai, req, { now: () => clock, sleep: async (ms) => { clock += 30_000 + ms; }, budgetMs: 45_000, minAttemptMs: 6_000 }).catch((x) => x);
  assert.equal(e.failure, 'busy');
  assert.ok(s.models.length <= 3 && s.models.length < 8, `attempts ${s.models.length} (would be 8 without the budget)`);
});

test('default chain: 8 unique models, original four first, no retired 2.5 models', () => {
  assert.equal(DEFAULT_SCAN_MODELS.length, 8);
  assert.equal(new Set(DEFAULT_SCAN_MODELS).size, 8);
  assert.deepEqual(DEFAULT_SCAN_MODELS.slice(0, 4), ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash']);
  assert.ok(DEFAULT_SCAN_MODELS.every((m) => /^gemini-/.test(m) && !m.includes('2.5')));
});

test('GEMINI_MODELS: comma list is trimmed / de-duplicated / "models/" prefix stripped; unset, empty or invalid → default chain; capped', () => {
  assert.deepEqual(parseModelList(' gemini-a , models/gemini-b,,gemini-a,bad name!,$x '), ['gemini-a', 'gemini-b']);
  assert.deepEqual(parseModelList(undefined), [...DEFAULT_SCAN_MODELS]);
  assert.deepEqual(parseModelList(''), [...DEFAULT_SCAN_MODELS]);
  assert.deepEqual(parseModelList(' , ;; '), [...DEFAULT_SCAN_MODELS]);
  assert.equal(parseModelList(Array.from({ length: 30 }, (_, i) => `m${i}`).join(',')).length, MAX_SCAN_MODELS);
  assert.deepEqual(resolveScanModels({ GEMINI_MODELS: 'x1,x2' }), ['x1', 'x2']);
  assert.deepEqual(resolveScanModels({}), [...DEFAULT_SCAN_MODELS]);
});

test('generateWithFallback uses the GEMINI_MODELS env chain when no models option is given', async () => {
  const prev = process.env.GEMINI_MODELS;
  process.env.GEMINI_MODELS = 'env-one,env-two';
  try {
    const s = script([quota('40s'), 'ok']);
    const r = await generateWithFallback(s.ai, req, { sleep: noSleep });
    assert.deepEqual(s.models, ['env-one', 'env-two']);
    assert.equal(r.model, 'env-two');
    const explicit = script(['ok']);
    assert.equal((await generateWithFallback(explicit.ai, req, { models: ['explicit'], sleep: noSleep })).model, 'explicit');
  } finally {
    if (prev === undefined) delete process.env.GEMINI_MODELS; else process.env.GEMINI_MODELS = prev;
  }
});

test('missing (404) and quota (429) models are skipped instantly all the way down the long default chain', async () => {
  const s = script([api(404, 'gone'), quota('40s'), api(404, 'gone'), quota('40s'), api(404, 'gone'), quota('40s'), api(404, 'gone'), 'ok']);
  const r = await generateWithFallback(s.ai, req, { sleep: noSleep });
  assert.equal(r.model, DEFAULT_SCAN_MODELS[7]);
  assert.deepEqual(s.models, [...DEFAULT_SCAN_MODELS]);
});

test('overloaded everywhere: total attempts are capped (same-model retry only for the first models) and the budget still holds', async () => {
  const s = script([overloaded()]);
  const e: any = await generateWithFallback(s.ai, req, { sleep: noSleep }).catch((x) => x);
  assert.equal(e.failure, 'busy');
  assert.equal(s.models.length, 10);
  assert.deepEqual([...new Set(s.models)], [...DEFAULT_SCAN_MODELS]);
  const c = script([overloaded()]);
  await generateWithFallback(c.ai, req, { sleep: noSleep, maxAttempts: 3 }).catch(() => {});
  assert.equal(c.models.length, 3);
  // worst case with real timeouts: every attempt burns the 20 s limit, the 45 s budget stops the walk after a few of them
  let clock = 0;
  const h = { ai: { models: { generateContent: async () => { clock += 20_000; throw Object.assign(new Error('t'), { name: 'AbortError' }); } } } } as any;
  const e2: any = await generateWithFallback(h, req, { now: () => clock, sleep: async (ms) => { clock += ms; } }).catch((x) => x);
  assert.equal(e2.failure, 'busy');
  assert.ok(clock <= 45_000 + 20_000, `virtual time ${clock}`);
});

// ───────── server: HTTP route ─────────
async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const post = (base: string, body: unknown) => fetch(base + '/api/scan-document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pushDeps = () => ({ store: new MemoryStore(), config: { publicKey: '', privateKey: '', subject: '', cronSecret: 's' } as any });
const quiet = async <T>(fn: () => Promise<T>) => { const o = [console.error, console.warn]; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { [console.error, console.warn] = o; } };
const fast = { sleep: noSleep };

test('HTTP scan: transient 503 from the model is absorbed by the retry — the user gets a normal 200 result', async () => {
  const s = script([overloaded(), 'ok']);
  const app = createApiApp(pushDeps(), { getAi: () => s.ai, geminiRetry: fast });
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, { documentText: 'Electric bill', userName: 'Ada' });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as any).success, true);
  }));
  assert.equal(s.models.length, 2);
});

test('HTTP scan: PDF (inline application/pdf) with 429 on the first model still succeeds through the fallback model', async () => {
  const s = script([quota(), 'ok']);
  const app = createApiApp(pushDeps(), { getAi: () => s.ai, geminiRetry: fast });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, { imageBase64: 'data:application/pdf;base64,' + pdf, mimeType: 'application/pdf', documentText: 'bill.pdf', userName: 'Ada' });
    assert.equal(r.status, 200);
  }));
  assert.deepEqual(s.models, [DEFAULT_SCAN_MODELS[0], DEFAULT_SCAN_MODELS[1]]);
});

test('HTTP scan: all models busy → 503 SCAN_BUSY with Retry-After and an honest "scanner busy" message (not a network error, no raw text)', async () => {
  const app = createApiApp(pushDeps(), { getAi: () => script([overloaded()]).ai, geminiRetry: fast });
  await quiet(() => withServer(app, async (base) => {
    const r = await post(base, { documentText: 'Electric bill', userName: 'Ada' });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '10');
    const text = await r.text();
    const j = JSON.parse(text);
    assert.equal(j.code, 'SCAN_BUSY');
    assert.equal(j.success, false);
    assert.ok(!/quota|high demand|gemini|SECRET|free_tier/i.test(text), text);
    assert.match(j.error, /busy/i);
  }));
});

test('HTTP scan: rejected API key → 503 SCAN_UNAVAILABLE (single call); other model errors stay a 502 SCAN_FAILED', async () => {
  const a = script([api(403, 'denied')]);
  await quiet(() => withServer(createApiApp(pushDeps(), { getAi: () => a.ai, geminiRetry: fast }), async (base) => {
    const r = await post(base, { documentText: 'x' });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).code, 'SCAN_UNAVAILABLE');
  }));
  assert.equal(a.models.length, 1);
  const b = script([new Error('weird')]);
  await quiet(() => withServer(createApiApp(pushDeps(), { getAi: () => b.ai, geminiRetry: fast }), async (base) => {
    const r = await post(base, { documentText: 'x' });
    assert.equal(r.status, 502);
    assert.equal(((await r.json()) as any).code, 'SCAN_FAILED');
  }));
});

test('HTTP scan: rate limit allows 40 scans per 10 minutes per IP (several documents plus automatic retries)', async () => {
  const s = script(['ok']);
  const app = createApiApp(pushDeps(), { getAi: () => s.ai, geminiRetry: fast });
  await quiet(() => withServer(app, async (base) => {
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) statuses.push((await post(base, { documentText: 'x' })).status);
    assert.equal(statuses.filter((x) => x === 200).length, 40);
    assert.equal(statuses[40], 429);
  }));
});

// ───────── client: response classification + automatic retry ─────────
const res = (status: number, ctype: string | null, body: unknown) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ctype : null) },
  json: async () => body,
}) as any;
const busyBody = { success: false, code: 'SCAN_BUSY', error: 'The scanning service is busy right now. Please try again in a moment.' };

test('client: 503 SCAN_BUSY is "busy" (NOT network, NOT "unavailable"), retryable, and keeps the server message', async () => {
  const e: any = await readScanResponse(res(503, 'application/json', busyBody)).catch((x) => x);
  assert.ok(e instanceof ScanError);
  assert.equal(e.kind, 'busy');
  const f = classifyScanFailure(e, { online: true });
  assert.equal(f.kind, 'busy');
  assert.equal(f.retryable, true);
  assert.match(f.message, /busy/i);
  assert.doesNotMatch(f.message, /network|connection/i);
  // a real "not configured" 503 stays unavailable
  const u: any = await readScanResponse(res(503, 'application/json', { success: false, code: 'SCAN_UNAVAILABLE', error: 'n/a' })).catch((x) => x);
  assert.equal(u.kind, 'unavailable');
});

test('client: a JSON 502/500 from the scan route (AI failure) is an AI error, while a bare HTML gateway page is still a network/upstream problem', async () => {
  const ai: any = await readScanResponse(res(502, 'application/json', { success: false, code: 'SCAN_FAILED', error: 'We could not read this document.' })).catch((x) => x);
  assert.equal(ai.kind, 'ai');
  const gw: any = await readScanResponse(res(502, 'text/html', '<html>')).catch((x) => x);
  assert.equal(gw.kind, 'network');
});

test('requestScan: one automatic retry after a busy answer, then the result is returned', async () => {
  const replies = [res(503, 'application/json', busyBody), res(200, 'application/json', { success: true, data: { eventTitle: 'ok' } })];
  let calls = 0; const sleeps: number[] = [];
  const data = await requestScan({ a: 1 }, { isOnline: () => true, sleep: async (ms) => { sleeps.push(ms); }, fetchImpl: (async () => replies[calls++]) as any });
  assert.deepEqual(data, { eventTitle: 'ok' });
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
});

test('requestScan: retries a dropped connection / gateway blip once; gives up after the second failure; never more than 2 requests', async () => {
  let calls = 0;
  const r1 = await requestScan({}, { isOnline: () => true, sleep: noSleep, fetchImpl: (async () => { if (calls++ === 0) throw new TypeError('Load failed'); return res(200, 'application/json', { success: true, data: { x: 1 } }); }) as any });
  assert.deepEqual(r1, { x: 1 });
  calls = 0;
  const e: any = await requestScan({}, { isOnline: () => true, sleep: noSleep, fetchImpl: (async () => { calls++; return res(502, 'text/html', '<html>'); }) as any }).catch((x) => x);
  assert.equal(calls, 2);
  assert.equal(e.kind, 'network');
});

test('requestScan: NOT retried for offline, timeout, rate limit, too large, unreadable file, or an AI failure that is not a 5xx', async () => {
  const cases: Array<[string, () => Promise<any>]> = [
    ['429', async () => res(429, 'application/json', { success: false })],
    ['413', async () => res(413, 'application/json', { success: false })],
    ['422', async () => res(422, 'application/json', { success: false, code: 'UNREADABLE_DOCUMENT', error: 'bad' })],
    ['400', async () => res(400, 'application/json', { success: false, error: 'bad' })],
    ['abort', async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }],
  ];
  for (const [name, f] of cases) {
    let calls = 0;
    await requestScan({}, { isOnline: () => true, sleep: noSleep, fetchImpl: (async () => { calls++; return f(); }) as any }).catch(() => {});
    assert.equal(calls, 1, name);
  }
  let calls = 0;
  await requestScan({}, { isOnline: () => false, sleep: noSleep, fetchImpl: (async () => { calls++; return res(200, 'application/json', {}); }) as any }).catch(() => {});
  assert.equal(calls, 0);
  assert.equal(isTransientScanError(new ScanError('x', 502, 'ai')), true);
  assert.equal(isTransientScanError(new ScanError('x', 200, 'ai')), false);
});

test('requestScan: timeout 75 s default stays above the server budget (45 s) and below nothing else', async () => {
  const { SCAN_TIMEOUT_MS } = await import('../src/lib/scanErrors');
  assert.equal(SCAN_TIMEOUT_MS, 75_000);
  // two attempts of up to 75 s would be long: the second attempt only happens after a FAST failure (busy/gateway), never after a timeout
  assert.equal(isTransientScanError(new ScanError('t', undefined, 'network', 'timeout')), false);
});

// ───────── client: soft refresh never interrupts a scan ─────────
test('scanActivity: in-flight scans are tracked, ended scans are released, leaked ones expire', () => {
  resetScanActivity();
  assert.equal(isScanInFlight(), false);
  const end = beginScan();
  assert.equal(isScanInFlight(), true);
  end(); end();
  assert.equal(isScanInFlight(), false);
  beginScan(() => 1_000);
  assert.equal(isScanInFlight(1_000 + 60_000), true);
  assert.equal(isScanInFlight(1_000 + 6 * 60_000), false, 'safety expiry');
});

test('soft refresh is deferred (banner), never a reload, while a scan is running — even after a very long absence', () => {
  resetScanActivity();
  let t = 10_000_000; let refreshed = 0; let deferred = 0;
  const listeners: Record<string, Array<() => void>> = {};
  let visible = true;
  const add = (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); };
  const fire = (type: string) => (listeners[type] ?? []).forEach((f) => f());
  const off = installSessionFreshness({
    now: () => t, isVisible: () => visible,
    isBusy: () => isScanInFlight(t),
    saveState: () => {}, refresh: () => { refreshed++; }, defer: () => { deferred++; },
    addDocListener: add as any, removeDocListener: () => {}, addWinListener: add as any, removeWinListener: () => {},
  }, t);
  let end = () => {};
  // The scan was started just before the user came back (a scan lasts seconds; the 5-min safety expiry only frees leaked ones).
  const away = (ms: number, scanOnReturn = false) => { visible = false; fire('visibilitychange'); t += ms - 1_000; if (scanOnReturn) end = beginScan(() => t); t += 1_000; visible = true; fire('visibilitychange'); };
  away(HIDDEN_REFRESH_AFTER_MS + 1, true);
  assert.equal(refreshed, 0, 'no reload during a scan');
  assert.equal(deferred, 1);
  end();
  away(HIDDEN_REFRESH_AFTER_MS + 1);
  assert.equal(refreshed, 1, 'refresh works again once the scan is over');
  off();
  assert.equal(decideFreshness({ now: 100, hiddenAt: 0, sessionStart: 0, busy: true }), 'none');
});

test('static: App.tsx treats an in-flight scan as busy for the soft refresh; UploadModal registers scans (and always releases them)', async () => {
  const { promises: fs } = await import('node:fs');
  const app = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /isScanInFlight\(\)/);
  const modal = await fs.readFile(new URL('../src/components/UploadModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /beginScan\(\)/);
  assert.equal((modal.match(/beginScan\(\)/g) ?? []).length, (modal.match(/\bend(Scan|Prepare)\(\);/g) ?? []).length, 'every beginScan has an end in a finally');
  assert.match(modal, /'Scanner busy'/);
});
