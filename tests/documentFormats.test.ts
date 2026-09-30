import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { createApiApp } from '../backend/apiApp';
import { validateScanRequest, looksLikeFileType, MAX_IMAGE_BASE64_CHARS, CORRUPT_FILE_MESSAGE } from '../backend/scanValidation';
import { extractDocumentText, inspectZip, DocumentExtractionError, MAX_EXTRACTED_CHARS } from '../backend/documentText';
import {
  FILE_INPUT_ACCEPT, MAX_UPLOAD_FILE_BYTES, DOCX_MIME, DOC_MIME, XLSX_MIME, XLS_MIME,
  checkUploadFile, resolveUploadMime, toDataUrl, stripDataUrlPrefix, kindOfMime, SUPPORTED_MIME_TYPES,
} from '../src/lib/uploadFormats';
import { readScanResponse, ScanError } from '../src/lib/scanClient';
import { MemoryStore } from '../push-server/store';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const b64 = (name: string) => fs.readFileSync(path.join(dir, name)).toString('base64');

const FIXTURES = [
  { file: 'sample-bill.pdf', mime: 'application/pdf' },
  { file: 'sample-bill.docx', mime: DOCX_MIME },
  { file: 'sample-bill.doc', mime: DOC_MIME },
  { file: 'sample-appt.xlsx', mime: XLSX_MIME },
  { file: 'sample-appt.xls', mime: XLS_MIME },
  { file: 'sample-appt.csv', mime: 'text/csv' },
  { file: 'sample-note.txt', mime: 'text/plain' },
] as const;

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const post = (base: string, body: unknown) =>
  fetch(base + '/api/scan-document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pushDeps = () => ({ store: new MemoryStore(), config: { publicKey: '', privateKey: '', subject: '', cronSecret: 's' } as any });
const MODEL_ITEM = { hospitalName: 'Eko Electricity', patientName: 'Ada Lovelace', patientMatch: 'Matches Profile: Self', diagnosis: 'Bill', appointmentDate: '15/11/2026', appointmentTime: '08:00 AM', eventTitle: 'Pay bill', shortNote: 'Pay', accuracy: 90, category: 'Bills & Invoices' };
function capturingAi() {
  const calls: any[] = [];
  const ai = () => ({ models: { generateContent: async (req: any) => { calls.push(req); return { text: JSON.stringify({ ...MODEL_ITEM, extractedItems: [MODEL_ITEM] }) }; } } }) as any;
  return { ai, calls };
}

// ───────────── validation: every format with correct magic bytes ─────────────

test('validation accepts each supported document type with correct magic bytes', () => {
  for (const { file, mime } of FIXTURES) {
    const r = validateScanRequest({ imageBase64: `data:${mime};base64,${b64(file)}`, mimeType: mime, documentText: file });
    assert.equal(r.ok, true, `${file} (${mime}) should be accepted: ${JSON.stringify(r)}`);
    if (r.ok) { assert.equal(r.value.mimeType, mime); assert.ok(!r.value.imageBase64.startsWith('data:')); }
  }
});

test('fixtures really start with the expected signatures', () => {
  const head = (f: string) => fs.readFileSync(path.join(dir, f)).subarray(0, 8);
  assert.equal(head('sample-bill.pdf').subarray(0, 4).toString('latin1'), '%PDF');
  assert.deepEqual([...head('sample-bill.docx').subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...head('sample-appt.xlsx').subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...head('sample-bill.doc')], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.deepEqual([...head('sample-appt.xls')], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
});

test('validation rejects mismatched / corrupt files (400) and unknown types', () => {
  const junk = Buffer.from('this is definitely not a binary office file at all, just words').toString('base64');
  const zeros = Buffer.alloc(64).toString('base64');
  const cases: [string, string, string][] = [
    ['PDF declared, docx bytes', 'application/pdf', b64('sample-bill.docx')],
    ['docx declared, PDF bytes', DOCX_MIME, b64('sample-bill.pdf')],
    ['xlsx declared, legacy OLE bytes', XLSX_MIME, b64('sample-appt.xls')],
    ['xls declared, ZIP bytes', XLS_MIME, b64('sample-appt.xlsx')],
    ['doc declared, ZIP bytes', DOC_MIME, b64('sample-bill.docx')],
    ['docx declared, plain text', DOCX_MIME, junk],
    ['xlsx declared, zero bytes', XLSX_MIME, zeros],
    ['pdf declared, plain text', 'application/pdf', junk],
    ['jpeg declared, PDF bytes', 'image/jpeg', b64('sample-bill.pdf')],
    ['txt declared, PDF bytes', 'text/plain', b64('sample-bill.pdf')],
    ['csv declared, xlsx bytes', 'text/csv', b64('sample-appt.xlsx')],
    ['txt declared, NUL bytes', 'text/plain', zeros],
  ];
  for (const [label, mime, data] of cases) {
    const r = validateScanRequest({ imageBase64: data, mimeType: mime });
    assert.equal(r.ok, false, label);
    if (!r.ok) { assert.equal(r.status, 400, label); assert.equal(r.error, CORRUPT_FILE_MESSAGE, label); }
  }
  for (const mime of ['application/zip', 'application/x-msdownload', 'text/html', 'application/octet-stream']) {
    const r = validateScanRequest({ imageBase64: b64('sample-bill.pdf'), mimeType: mime });
    assert.equal(r.ok, false, mime);
    if (!r.ok) assert.match(r.error, /Unsupported file type/);
  }
});

test('validation: MIME parameters/case are tolerated; over-size documents are 413 with a friendly message', () => {
  const ok = validateScanRequest({ imageBase64: b64('sample-bill.pdf'), mimeType: 'Application/PDF; charset=binary' });
  assert.equal(ok.ok, true);
  const big = validateScanRequest({ imageBase64: 'UEsDBA' + 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 10), mimeType: DOCX_MIME });
  assert.equal(big.ok, false);
  if (!big.ok) { assert.equal(big.status, 413); assert.match(big.error, /too large/i); }
  assert.equal(looksLikeFileType('', 'application/pdf'), false);
  assert.equal(SUPPORTED_MIME_TYPES.includes('text/csv'), true);
});

// ───────────── client helpers ─────────────

test('file input accepts images, PDF, Word, Excel, CSV and TXT', () => {
  const parts = FILE_INPUT_ACCEPT.split(',');
  for (const p of ['image/*', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt']) assert.ok(parts.includes(p), `accept lacks ${p}`);
});

test('resolveUploadMime: known extension wins over empty/wrong browser types', () => {
  assert.equal(resolveUploadMime({ name: 'Bill.DOCX', type: '' }), DOCX_MIME);
  assert.equal(resolveUploadMime({ name: 'old.doc', type: '' }), DOC_MIME);
  assert.equal(resolveUploadMime({ name: 'sheet.xls', type: 'application/octet-stream' }), XLS_MIME);
  assert.equal(resolveUploadMime({ name: 'data.csv', type: 'application/vnd.ms-excel' }), 'text/csv');
  assert.equal(resolveUploadMime({ name: 'scan', type: 'image/png' }), 'image/png');
  assert.equal(resolveUploadMime({ name: 'photo.jpg', type: 'image/jpeg' }), 'image/jpeg');
  assert.equal(resolveUploadMime({ name: 'malware.exe', type: 'application/x-msdownload' }), undefined);
  assert.equal(resolveUploadMime({ name: 'noext', type: '' }), undefined);
});

test('checkUploadFile: supported types pass, documents over the hard limit get a friendly error, larger ones pass to browser-side shrinking', () => {
  for (const [name, kind] of [['a.pdf', 'pdf'], ['a.docx', 'office'], ['a.xlsx', 'office'], ['a.xls', 'office'], ['a.doc', 'office'], ['a.csv', 'text'], ['a.txt', 'text'], ['a.png', 'image']] as const) {
    const r = checkUploadFile({ name, type: '', size: 1000 });
    assert.equal(r.ok, true, name);
    if (r.ok) assert.equal(r.kind, kind);
  }
  // Files above 3 MB are no longer refused: the browser shrinks them first (see largeFile.test.ts). Only the 50 MB hard limit is.
  assert.equal(checkUploadFile({ name: 'big.pdf', type: 'application/pdf', size: MAX_UPLOAD_FILE_BYTES + 1 }).ok, true);
  const huge = checkUploadFile({ name: 'huge.pdf', type: 'application/pdf', size: 60_000_000 });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.match(huge.error, /too large.*50 MB/i);
  assert.equal(checkUploadFile({ name: 'phone.jpg', type: 'image/jpeg', size: 12_000_000 }).ok, true, 'photos are downscaled, not rejected');
  const bad = checkUploadFile({ name: 'x.exe', type: '', size: 10 });
  assert.equal(bad.ok, false);
  assert.equal(checkUploadFile({ name: 'a.pdf', type: '', size: 0 }).ok, false);
  // a max-size file still fits the server's base64 cap
  assert.ok(Math.ceil(MAX_UPLOAD_FILE_BYTES / 3) * 4 <= MAX_IMAGE_BASE64_CHARS);
});

test('toDataUrl forces the resolved MIME type and never touches document bytes', () => {
  const raw = b64('sample-bill.docx');
  const wrong = `data:application/octet-stream;base64,${raw}`;
  const fixed = toDataUrl(wrong, DOCX_MIME);
  assert.equal(fixed, `data:${DOCX_MIME};base64,${raw}`);
  assert.equal(stripDataUrlPrefix(fixed), raw);
  assert.equal(toDataUrl(raw, 'application/pdf'), `data:application/pdf;base64,${raw}`);
  assert.equal(kindOfMime('application/pdf'), 'pdf');
});

test('readScanResponse: 413 and 422 show friendly messages (no raw parse errors)', async () => {
  const mk = (status: number, body: any, type = 'application/json') => ({ ok: status < 300, status, headers: new Headers({ 'content-type': type }), json: async () => body });
  await assert.rejects(readScanResponse(mk(413, 'Request Entity Too Large', 'text/plain') as any), (e: any) => e instanceof ScanError && /too large.*3 MB/i.test(e.message));
  await assert.rejects(readScanResponse(mk(422, { success: false, error: 'We could not open that document.' }) as any), (e: any) => e instanceof ScanError && e.message === 'We could not open that document.');
});

// ───────────── extraction (real fixtures) ─────────────

test('extractDocumentText reads the docx, doc, xlsx, xls, csv and txt samples', async () => {
  for (const [file, mime] of [['sample-bill.docx', DOCX_MIME], ['sample-bill.doc', DOC_MIME]] as const) {
    const t = await extractDocumentText(b64(file), mime);
    assert.match(t, /Ada Lovelace/, file);
    assert.match(t, /15 November 2026/, file);
    assert.match(t, /42,500/, file);
  }
  for (const [file, mime] of [['sample-appt.xlsx', XLSX_MIME], ['sample-appt.xls', XLS_MIME], ['sample-appt.csv', 'text/csv']] as const) {
    const t = await extractDocumentText(b64(file), mime);
    assert.match(t, /Eko Electricity/, file);
    assert.match(t, /15\/11\/2026/, file);
    assert.match(t, /St Nicholas Dental/, file);
  }
  assert.match(await extractDocumentText(b64('sample-note.txt'), 'text/plain'), /02\/12\/2026/);
});

test('extractDocumentText: corrupt / wrong / empty documents fail with a friendly DocumentExtractionError', async () => {
  const zipJunk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]).toString('base64');
  const oleJunk = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(200, 7)]).toString('base64');
  const notXlsx = b64('sample-bill.docx'); // a valid zip, but a Word package
  const cases: [string, string][] = [[zipJunk, DOCX_MIME], [zipJunk, XLSX_MIME], [oleJunk, DOC_MIME], [notXlsx, XLSX_MIME], [b64('sample-appt.xlsx'), DOCX_MIME], [Buffer.from('   \n ').toString('base64'), 'text/plain']];
  const orig = console.error; console.error = () => {};
  try {
    for (const [data, mime] of cases) {
      await assert.rejects(extractDocumentText(data, mime), (e: any) => e instanceof DocumentExtractionError && e.message.length > 10 && !/\bat \S+:\d+|node_modules|RangeError/.test(e.message), mime);
    }
  } finally { console.error = orig; }
});

test('extractDocumentText: output is capped; zip inspection reads entry names without inflating', async () => {
  const big = Buffer.from('x'.repeat(MAX_EXTRACTED_CHARS + 5000)).toString('base64');
  assert.equal((await extractDocumentText(big, 'text/plain')).length, MAX_EXTRACTED_CHARS);
  const info = inspectZip(fs.readFileSync(path.join(dir, 'sample-bill.docx')));
  assert.ok(info.names.includes('word/document.xml'));
  assert.ok(inspectZip(fs.readFileSync(path.join(dir, 'sample-appt.xlsx'))).names.includes('xl/workbook.xml'));
});

// ───────────── HTTP end to end (mocked Gemini) ─────────────

test('HTTP scan: PDF and images are sent to the model inline with the correct MIME type', async () => {
  const { ai, calls } = capturingAi();
  await withServer(createApiApp(pushDeps(), { getAi: ai }), async (base) => {
    const r = await post(base, { imageBase64: `data:application/pdf;base64,${b64('sample-bill.pdf')}`, mimeType: 'application/pdf', documentText: 'sample-bill.pdf', userName: 'Ada Lovelace', familyMembers: [{ name: 'Ada Lovelace' }] });
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.equal(body.success, true);
    assert.equal(body.data.appointmentDate, '15/11/2026');
    const inline = calls[0].contents.parts.find((p: any) => p.inlineData);
    assert.equal(inline.inlineData.mimeType, 'application/pdf');
    assert.equal(inline.inlineData.data, b64('sample-bill.pdf'));
  });
});

test('HTTP scan: docx / doc / xlsx / xls / csv / txt are read on the server and sent to the model as text (no inline file)', async () => {
  const { ai, calls } = capturingAi();
  await withServer(createApiApp(pushDeps(), { getAi: ai }), async (base) => {
    for (const { file, mime } of FIXTURES.filter((f) => f.mime !== 'application/pdf')) {
      const r = await post(base, { imageBase64: `data:${mime};base64,${b64(file)}`, mimeType: mime, documentText: file, userName: 'Ada Lovelace', familyMembers: [{ name: 'Ada Lovelace' }] });
      assert.equal(r.status, 200, `${file}: ${await r.clone().text()}`);
      assert.equal(((await r.json()) as any).success, true, file);
      const req = calls[calls.length - 1];
      assert.equal(req.contents.parts.some((p: any) => p.inlineData), false, `${file} must not be sent inline`);
      const prompt = req.contents.parts.map((p: any) => p.text || '').join('\n');
      assert.match(prompt, new RegExp(`File name: ${file.replace('.', '\\.')}`));
      assert.match(prompt, /15( November |\/11\/)2026|02\/12\/2026/, file);
    }
    assert.equal(calls.length, 6);
  });
});

test('HTTP scan: corrupt documents are refused with 400/422 before any model call; honest error, no fake data', async () => {
  const { ai, calls } = capturingAi();
  const zipJunk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(300, 7)]).toString('base64');
  const orig = console.error; console.error = () => {};
  try {
    await withServer(createApiApp(pushDeps(), { getAi: ai }), async (base) => {
      const mismatch = await post(base, { imageBase64: b64('sample-bill.pdf'), mimeType: DOCX_MIME });
      assert.equal(mismatch.status, 400);
      const corrupt = await post(base, { imageBase64: zipJunk, mimeType: DOCX_MIME, documentText: 'x.docx' });
      assert.equal(corrupt.status, 422);
      const body: any = await corrupt.json();
      assert.equal(body.success, false);
      assert.equal(body.data, undefined);
      assert.match(body.error, /could not open|corrupt/i);
      assert.equal(calls.length, 0);
    });
  } finally { console.error = orig; }
});

test('HTTP scan: rate limit still applies to document uploads', async () => {
  const { ai, calls } = capturingAi();
  await withServer(createApiApp(pushDeps(), { getAi: ai, scanRateLimit: { windowMs: 60_000, max: 2 } }), async (base) => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(base, { imageBase64: b64('sample-bill.pdf'), mimeType: 'application/pdf' })).status);
    assert.deepEqual(statuses, [200, 200, 429, 429]);
    assert.equal(calls.length, 2);
  });
});
