import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORK_MESSAGE, OFFLINE_MESSAGE, TIMEOUT_MESSAGE, ScanError, classifyScanFailure, isDynamicImportFailure, isFetchNetworkFailure,
  networkError, readScanResponse, requestScan,
} from '../src/lib/scanErrors';
import { prepareLargeFile, PrepareError, type PrepareDeps } from '../src/lib/prepareUpload';
import { PdfReadError } from '../src/lib/pdfClient';
import { OfficeReadError } from '../src/lib/officeClient';
import { PayloadTooLargeError } from '../src/lib/largeFile';

const res = (status: number, ctype: string | null, body: unknown, jsonThrows = false) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ctype : null) },
  json: async () => { if (jsonThrows) throw new SyntaxError('Unexpected end of JSON input'); return body; },
}) as any;
const err = async (r: any) => { try { await readScanResponse(r); } catch (e) { return e as ScanError; } throw new Error('did not throw'); };

// ───────── HTTP responses ─────────
test('5xx / 408 / non-JSON gateway replies are NETWORK problems (upstream), with the specific message', async () => {
  for (const r of [res(502, 'text/html', '<html>Bad gateway</html>'), res(504, 'text/plain', 'Gateway Timeout'), res(500, null, ''), res(503, 'text/html', '<h1>Service Unavailable</h1>'),
    res(408, 'application/json', { success: false }), res(200, 'text/html', '<html>Wi-Fi login</html>'), res(200, 'application/json', null, true), res(500, 'application/json', null, true)]) {
    const e = await err(r);
    assert.equal(e.kind, 'network', `status ${r.status}`);
    assert.equal(e.reason, 'upstream');
    assert.equal(e.message, NETWORK_MESSAGE);
  }
});

test('the app\'s own JSON errors are NOT network problems: too-large, rate-limit, unsupported, unavailable, AI failure', async () => {
  const cases: Array<[any, string]> = [
    [res(413, 'text/plain', 'Request Entity Too Large'), 'too-large'],
    [res(413, 'application/json', { success: false, error: 'Request body too large.' }), 'too-large'],
    [res(429, 'application/json', { success: false }), 'rate-limited'],
    [res(400, 'application/json', { success: false, error: 'Invalid request' }), 'unsupported'],
    [res(400, 'text/plain', 'bad'), 'unsupported'],
    [res(422, 'application/json', { success: false, code: 'UNREADABLE_DOCUMENT', error: 'We could not open that document.' }), 'unsupported'],
    [res(503, 'application/json', { success: false, code: 'SCAN_UNAVAILABLE', error: 'Document scanning is not available right now.' }), 'unavailable'],
    [res(502, 'application/json', { success: false, code: 'SCAN_FAILED', error: 'We could not read this document.' }), 'ai'],
    [res(500, 'application/json', { success: false, code: 'SCAN_ERROR', error: 'Something went wrong while scanning.' }), 'ai'],
    [res(200, 'application/json', { success: false, error: 'nope' }), 'ai'],
    [res(200, 'application/json', { success: true }), 'ai'],
  ];
  for (const [r, kind] of cases) {
    const e = await err(r);
    assert.equal(e.kind, kind, `${r.status} -> ${kind}`);
    assert.notEqual(e.message, NETWORK_MESSAGE);
    assert.ok(!/Unexpected|<html/i.test(e.message));
  }
  assert.match((await err(res(413, 'application/json', {}))).message, /too large.*3 MB/i);
  assert.equal((await err(res(422, 'application/json', { success: false, error: 'We could not open that document.' }))).message, 'We could not open that document.');
});

test('a good response returns the data', async () => {
  assert.deepEqual(await readScanResponse(res(200, 'application/json; charset=utf-8', { success: true, data: { eventTitle: 'x' } })), { eventTitle: 'x' });
});

// ───────── thrown errors ─────────
test('classify: fetch failures across browsers => network/fetch; offline flag => network/offline', () => {
  for (const e of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('NetworkError when attempting to fetch resource.'), new TypeError('The network connection was lost.'), new TypeError('fetch failed'), Object.assign(new Error('x'), { name: 'TypeError' }), new Error('net::ERR_INTERNET_DISCONNECTED')]) {
    const f = classifyScanFailure(e, { online: true });
    assert.equal(f.kind, 'network', e.message);
    assert.equal(f.reason, 'fetch');
    assert.equal(f.message, NETWORK_MESSAGE);
    assert.equal(f.retryable, true);
    assert.equal(classifyScanFailure(e, { online: false }).reason, 'offline');
  }
  assert.equal(classifyScanFailure(new TypeError('Failed to fetch'), { online: false }).message, OFFLINE_MESSAGE);
  assert.ok(isFetchNetworkFailure(new TypeError('x')));
});

test('classify: AbortError / TimeoutError => network/timeout with the timeout wording', () => {
  for (const name of ['AbortError', 'TimeoutError']) {
    const f = classifyScanFailure(Object.assign(new Error('signal is aborted'), { name }));
    assert.equal(f.kind, 'network');
    assert.equal(f.reason, 'timeout');
    assert.equal(f.message, TIMEOUT_MESSAGE);
  }
});

test('classify: lazy chunk download failures (pdf.js / mammoth / SheetJS) => network/chunk', () => {
  for (const m of ['Failed to fetch dynamically imported module: https://x/assets/pdfClient-abc.js', 'error loading dynamically imported module', 'Importing a module script failed.', 'Loading chunk 12 failed.']) {
    assert.ok(isDynamicImportFailure(new Error(m)), m);
    assert.equal(classifyScanFailure(new Error(m)).reason, 'chunk');
  }
  assert.equal(classifyScanFailure(Object.assign(new Error('x'), { name: 'ChunkLoadError' })).kind, 'network');
  assert.ok(!isDynamicImportFailure(new Error('corrupt pdf')));
});

test('classify: other failures stay distinct and keep their own message; unknown errors never leak raw text', () => {
  assert.deepEqual(
    (({ kind, message, retryable }) => ({ kind, message, retryable }))(classifyScanFailure(new PdfReadError('This PDF is password protected.'))),
    { kind: 'unsupported', message: 'This PDF is password protected.', retryable: false });
  assert.equal(classifyScanFailure(new OfficeReadError('corrupt')).kind, 'unsupported');
  assert.equal(classifyScanFailure(new PrepareError('Old .doc format')).kind, 'unsupported');
  const big = classifyScanFailure(new PayloadTooLargeError());
  assert.equal(big.kind, 'too-large');
  assert.equal(big.retryable, false);
  const ai = classifyScanFailure(new ScanError('We could not read this document.', 502, 'ai'));
  assert.equal(ai.kind, 'ai');
  assert.equal(ai.retryable, true);
  assert.equal(classifyScanFailure(new ScanError('Too many scans', 429)).kind, 'rate-limited');
  const unknown = classifyScanFailure(new RangeError('Maximum call stack SECRET'));
  assert.equal(unknown.kind, 'unknown');
  assert.ok(!/SECRET/.test(unknown.message));
  assert.equal(classifyScanFailure('a string').kind, 'unknown');
  assert.equal(classifyScanFailure(null).kind, 'unknown');
  // a ScanError of kind network re-reads the CURRENT online state
  assert.equal(classifyScanFailure(networkError('upstream', 502), { online: false }).message, OFFLINE_MESSAGE);
});

// ───────── requestScan: offline up front, timeout, mapping ─────────
test('requestScan: offline => rejects immediately with network/offline and NEVER calls fetch', async () => {
  let called = 0;
  const e: any = await requestScan({ a: 1 }, { isOnline: () => false, fetchImpl: (async () => { called++; return res(200, 'application/json', {}); }) as any }).catch((x) => x);
  assert.equal(called, 0);
  assert.ok(e instanceof ScanError);
  assert.equal(e.kind, 'network');
  assert.equal(e.reason, 'offline');
  assert.equal(e.message, OFFLINE_MESSAGE);
});

test('requestScan: a stalled request is aborted by the timeout (AbortController) => network/timeout', async () => {
  let aborted = false;
  const fetchImpl = ((_u: string, init: any) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => { aborted = true; rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); });
  })) as any;
  const t0 = Date.now();
  const e: any = await requestScan({}, { fetchImpl, timeoutMs: 40, isOnline: () => true }).catch((x) => x);
  assert.ok(aborted, 'fetch signal was aborted');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(e.kind, 'network');
  assert.equal(e.reason, 'timeout');
  assert.equal(e.message, TIMEOUT_MESSAGE);
});

test('requestScan: connection drop mid-flight => network/fetch; connection lost while failing => offline; success returns data; sends POST JSON + signal', async () => {
  const e1: any = await requestScan({}, { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as any, isOnline: () => true }).catch((x) => x);
  assert.equal(e1.reason, 'fetch');
  let online = true;
  const e2: any = await requestScan({}, { fetchImpl: (async () => { online = false; throw new TypeError('Load failed'); }) as any, isOnline: () => online }).catch((x) => x);
  assert.equal(e2.reason, 'offline');
  let seen: any;
  const data = await requestScan({ documentText: 'x' }, { isOnline: () => true, fetchImpl: (async (u: string, init: any) => { seen = { u, init }; return res(200, 'application/json', { success: true, data: { eventTitle: 'ok' } }); }) as any });
  assert.deepEqual(data, { eventTitle: 'ok' });
  assert.equal(seen.u, '/api/scan-document');
  assert.equal(seen.init.method, 'POST');
  assert.ok(seen.init.signal);
  assert.deepEqual(JSON.parse(seen.init.body), { documentText: 'x' });
  // response body reading is covered by the timeout too: a 502 HTML page is upstream
  const e3: any = await requestScan({}, { isOnline: () => true, fetchImpl: (async () => res(502, 'text/html', '<html>')) as any }).catch((x) => x);
  assert.equal(e3.kind, 'network');
  assert.equal(e3.reason, 'upstream');
  // programming errors are not disguised as network problems
  const e4: any = await requestScan({}, { isOnline: () => true, fetchImpl: (async () => { throw new RangeError('boom'); }) as any }).catch((x) => x);
  assert.ok(!(e4 instanceof ScanError));
  assert.equal(classifyScanFailure(e4).kind, 'unknown');
});

// ───────── large-file in-browser path ─────────
const blob = (size: number, name = 'big.pdf') => ({ name, size, arrayBuffer: async () => new ArrayBuffer(4) }) as any;
function failingDeps(over: Partial<PrepareDeps>): PrepareDeps {
  const nope = async () => { throw new Error('unused'); };
  return { readBuffer: async () => new ArrayBuffer(4), loadPdfjs: nope as any, openPdf: nope as any, extractPdfText: nope as any, makePageRenderer: nope as any, extractDocx: nope as any, extractSheet: nope as any, extractPlain: nope as any, ...over };
}

test('large file: reader chunk that cannot be downloaded (pdf.js / mammoth / SheetJS) => network problem, not "bad file"', async () => {
  const chunk = new TypeError('Failed to fetch dynamically imported module: /assets/pdfClient.js');
  const cases: Array<[any, { kind: any; mime: string }, Partial<PrepareDeps>]> = [
    [blob(9e6, 'a.pdf'), { kind: 'pdf', mime: 'application/pdf' }, { loadPdfjs: async () => { throw chunk; } }],
    [blob(9e6, 'a.docx'), { kind: 'office', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, { extractDocx: async () => { throw chunk; } }],
    [blob(9e6, 'a.xlsx'), { kind: 'office', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { extractSheet: async () => { throw chunk; } }],
  ];
  for (const [file, info, over] of cases) {
    const e: any = await prepareLargeFile(file, info, failingDeps(over)).catch((x) => x);
    assert.ok(e instanceof ScanError, file.name);
    assert.equal(e.kind, 'network');
    assert.equal(e.reason, 'chunk');
    assert.equal(classifyScanFailure(e).message, NETWORK_MESSAGE);
    assert.equal(classifyScanFailure(e).retryable, true);
  }
});

test('large file: genuine read failures stay "unsupported" with their own message (unchanged)', async () => {
  const e: any = await prepareLargeFile(blob(9e6, 'a.pdf'), { kind: 'pdf', mime: 'application/pdf' }, failingDeps({ loadPdfjs: async () => ({}) as any, openPdf: async () => { throw new PdfReadError('This PDF is password protected.'); } })).catch((x) => x);
  assert.ok(e instanceof PrepareError);
  assert.equal(classifyScanFailure(e).kind, 'unsupported');
  assert.equal(classifyScanFailure(e).message, 'This PDF is password protected.');
});

test('static: the scan UI checks navigator.onLine up front and uses requestScan (timeout) — no bare fetch to /api/scan-document', async () => {
  const { promises: fs } = await import('node:fs');
  const src = await fs.readFile(new URL('../src/components/UploadModal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(\s*['"]\/api\/scan-document/);
  assert.match(src, /requestScan\(/);
  assert.match(src, /navigator\.onLine/);
  assert.match(src, /classifyScanFailure\(/);
});
