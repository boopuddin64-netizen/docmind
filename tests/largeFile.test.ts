import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { createApiApp } from '../backend/apiApp';
import { validateScanRequest, MAX_IMAGE_BASE64_CHARS, MAX_PAGE_IMAGES, MAX_TEXT_CHARS } from '../backend/scanValidation';
import { MemoryStore } from '../push-server/store';
import {
  planUpload, decidePdfMode, capText, normalizeText, buildTextPayload, fitPagesToBudget, fitImageToBudget, partialPagesNotice,
  base64Length, totalBase64Length, PayloadTooLargeError, LARGE_FILE_THRESHOLD_BYTES, MAX_CLIENT_TEXT_CHARS, MIN_PDF_TEXT_CHARS,
  MAX_SCAN_PAGES, IMAGE_PAYLOAD_BUDGET_CHARS, LEGACY_DOC_MESSAGE, RENDER_LADDER,
} from '../src/lib/largeFile';
import { extractPdfText, openPdf, PdfReadError, PDF_CORRUPT_MESSAGE, PDF_PASSWORD_MESSAGE, toPdfReadError, type PdfjsLike } from '../src/lib/pdfClient';
import { prepareLargeFile, PrepareError, type PrepareDeps } from '../src/lib/prepareUpload';
import { checkUploadFile, MAX_HARD_FILE_BYTES, DOCX_MIME, DOC_MIME, XLSX_MIME, XLS_MIME } from '../src/lib/uploadFormats';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => fs.readFileSync(path.join(here, 'fixtures', n));

// ───────────── thresholds / planning ─────────────

test('planUpload: 3 MB threshold decides inline vs browser-side handling', () => {
  const T = LARGE_FILE_THRESHOLD_BYTES;
  assert.equal(T, 3_000_000);
  assert.equal(planUpload({ kind: 'pdf', mime: 'application/pdf', size: T }).action, 'inline', 'exactly at the limit stays inline');
  assert.equal(planUpload({ kind: 'pdf', mime: 'application/pdf', size: T + 1 }).action, 'pdf');
  assert.equal(planUpload({ kind: 'office', mime: DOCX_MIME, size: T + 1 }).action, 'docx');
  assert.equal(planUpload({ kind: 'office', mime: XLSX_MIME, size: T + 1 }).action, 'sheet');
  assert.equal(planUpload({ kind: 'office', mime: XLS_MIME, size: T + 1 }).action, 'sheet');
  assert.equal(planUpload({ kind: 'text', mime: 'text/csv', size: T + 1 }).action, 'plain-text');
  assert.equal(planUpload({ kind: 'text', mime: 'text/plain', size: T + 1 }).action, 'plain-text');
  assert.equal(planUpload({ kind: 'office', mime: DOCX_MIME, size: 10 }).action, 'inline');
  // photos are always re-encoded, whatever the size (10+ MB phone photos)
  assert.equal(planUpload({ kind: 'image', mime: 'image/jpeg', size: 15_000_000 }).action, 'downscale-image');
  assert.equal(planUpload({ kind: 'image', mime: 'image/png', size: 100 }).action, 'downscale-image');
});

test('planUpload: large legacy .doc gets a friendly "save as .docx or PDF" message; small .doc is still read by the server', () => {
  const big = planUpload({ kind: 'office', mime: DOC_MIME, size: 5_000_000 });
  assert.equal(big.action, 'unsupported');
  if (big.action === 'unsupported') { assert.match(big.error, /\.docx or PDF/); assert.equal(big.error, LEGACY_DOC_MESSAGE); }
  assert.equal(planUpload({ kind: 'office', mime: DOC_MIME, size: 1_000_000 }).action, 'inline');
});

test('decidePdfMode: text if more than the minimum number of characters, else scan', () => {
  assert.equal(decidePdfMode(0), 'scan');
  assert.equal(decidePdfMode(MIN_PDF_TEXT_CHARS), 'scan');
  assert.equal(decidePdfMode(MIN_PDF_TEXT_CHARS + 1), 'text');
  assert.equal(decidePdfMode(50_000), 'text');
  assert.equal(decidePdfMode(120, 100), 'text');
});

test('checkUploadFile: files above 3 MB pass pre-flight, files above the 50 MB hard limit get a friendly error', () => {
  assert.equal(checkUploadFile({ name: 'big.pdf', type: 'application/pdf', size: 20_000_000 }).ok, true);
  assert.equal(checkUploadFile({ name: 'big.docx', type: '', size: MAX_HARD_FILE_BYTES }).ok, true);
  const tooBig = checkUploadFile({ name: 'huge.pdf', type: 'application/pdf', size: MAX_HARD_FILE_BYTES + 1 });
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.error, /too large.*50 MB/i);
  const hugePhoto = checkUploadFile({ name: 'huge.jpg', type: 'image/jpeg', size: 60_000_000 });
  assert.equal(hugePhoto.ok, false, 'even photos have the hard limit');
  assert.equal(checkUploadFile({ name: 'phone.jpg', type: 'image/jpeg', size: 14_000_000 }).ok, true, '10+ MB photo passes');
});

// ───────────── text capping ─────────────

test('capText / normalizeText: collapses whitespace, caps length, flags truncation, keeps surrogate pairs intact', () => {
  assert.equal(normalizeText('a \t b\r\n\r\n\r\n\r\nc\u0000  '), 'a b\n\nc');
  assert.deepEqual(capText('hello   world', 100), { text: 'hello world', truncated: false });
  const c = capText('x'.repeat(70_000));
  assert.equal(c.text.length, MAX_CLIENT_TEXT_CHARS);
  assert.equal(c.truncated, true);
  const emoji = capText('ab' + '😀'.repeat(10), 5); // cut would fall inside a surrogate pair
  assert.equal(emoji.truncated, true);
  assert.ok(emoji.text.length <= 5 && !/[\ud800-\udbff]$/.test(emoji.text));
  assert.equal(capText('', 10).text, '');
});

test('buildTextPayload: file name header, whole payload capped at the limit, name sanitised', () => {
  const p = buildTextPayload('bill\nreport.pdf', 'y'.repeat(90_000));
  assert.ok(p.documentText.startsWith('File name: bill report.pdf\n\nDocument contents:\n'));
  assert.equal(p.documentText.length, MAX_CLIENT_TEXT_CHARS);
  assert.equal(p.truncated, true);
  const small = buildTextPayload('a.csv', 'one,two');
  assert.equal(small.truncated, false);
  assert.ok(small.documentText.endsWith('one,two'));
  // the client cap fits the server cap
  assert.ok(MAX_CLIENT_TEXT_CHARS <= MAX_TEXT_CHARS);
  assert.ok(validateScanRequest({ documentText: p.documentText }).ok);
});

// ───────────── payload budgeting ─────────────

const fakeJpegDataUrl = (chars: number) => 'data:image/jpeg;base64,' + 'A'.repeat(chars);

test('base64Length ignores the data-URL prefix', () => {
  assert.equal(base64Length(fakeJpegDataUrl(100)), 100);
  assert.equal(base64Length('AAAA'), 4);
  assert.equal(totalBase64Length([fakeJpegDataUrl(10), 'AAAA']), 14);
});

test('fitPagesToBudget: first rung (1400px, q0.7) is used when pages fit; at most 6 pages; partial flag + notice', async () => {
  const calls: Array<[number, number, number]> = [];
  const render = async (i: number, o: { maxDimension: number; quality: number }) => { calls.push([i, o.maxDimension, o.quality]); return fakeJpegDataUrl(300_000); };
  const r = await fitPagesToBudget(render, 20);
  assert.equal(r.pagesRead, MAX_SCAN_PAGES);
  assert.equal(r.images.length, 6);
  assert.equal(r.partial, true);
  assert.deepEqual(r.options, { maxDimension: 1400, quality: 0.7 });
  assert.equal(r.totalChars, 1_800_000);
  assert.equal(calls.length, 6, 'no wasted renders when the first rung fits');
  assert.match(partialPagesNotice(r.pagesRead, r.totalPages), /20 pages.*first 6 pages were read/);
  const one = await fitPagesToBudget(render, 1);
  assert.equal(one.partial, false);
  assert.equal(partialPagesNotice(1, 1), '');
  assert.match(partialPagesNotice(1, 4), /first 1 page was read/);
});

test('fitPagesToBudget: lowers quality, then drops trailing pages, to stay under the 3.5 MB budget (never page 1)', async () => {
  // size proportional to quality*dimension: only lower rungs fit
  const sizeFor = (o: { maxDimension: number; quality: number }) => Math.round(o.quality * o.maxDimension * 900);
  const render = async (_i: number, o: { maxDimension: number; quality: number }) => fakeJpegDataUrl(sizeFor(o));
  const r = await fitPagesToBudget(render, 6);
  assert.ok(r.totalChars <= IMAGE_PAYLOAD_BUDGET_CHARS);
  assert.ok(r.options.quality < 0.7 || r.options.maxDimension < 1400, 'had to shrink');

  // even the smallest rung is too big for 6 pages → pages are dropped
  const bigRender = async () => fakeJpegDataUrl(1_200_000);
  const d = await fitPagesToBudget(bigRender, 6);
  assert.equal(d.images.length, 2);
  assert.equal(d.partial, true);
  assert.ok(d.totalChars <= IMAGE_PAYLOAD_BUDGET_CHARS);
  assert.equal(d.options, RENDER_LADDER[RENDER_LADDER.length - 1]);

  // page 1 alone is over budget → friendly error, not a silent oversized request
  await assert.rejects(fitPagesToBudget(async () => fakeJpegDataUrl(IMAGE_PAYLOAD_BUDGET_CHARS + 1), 3), PayloadTooLargeError);
  await assert.rejects(fitPagesToBudget(async () => 'x', 0), PayloadTooLargeError);
  // render errors propagate
  await assert.rejects(fitPagesToBudget(async () => { throw new PdfReadError('boom'); }, 2), /boom/);
});

test('fitImageToBudget: a huge photo is re-encoded down the ladder until it fits; impossible photos fail with a friendly error', async () => {
  const tried: number[] = [];
  const out = await fitImageToBudget(async (o) => { tried.push(o.quality); return fakeJpegDataUrl(o.quality > 0.6 ? 5_000_000 : 900_000); });
  assert.equal(base64Length(out), 900_000);
  assert.deepEqual(tried, [0.8, 0.65, 0.5]);
  await assert.rejects(fitImageToBudget(async () => fakeJpegDataUrl(9_000_000)), (e: any) => e instanceof PayloadTooLargeError && /photo/i.test(e.message));
  // encode errors (corrupt image) propagate unchanged
  await assert.rejects(fitImageToBudget(async () => { throw new Error('decode'); }), /decode/);
});

test('budget invariant: worst-case client payload fits the server cap and the 4.5 MB request limit', () => {
  const jsonOverhead = 20_000; // names, family list, keys, file name
  assert.ok(IMAGE_PAYLOAD_BUDGET_CHARS < MAX_IMAGE_BASE64_CHARS);
  assert.ok(IMAGE_PAYLOAD_BUDGET_CHARS + jsonOverhead < 4_500_000);
  assert.ok(MAX_CLIENT_TEXT_CHARS * 4 /* worst case: every char escaped/multibyte in JSON */ + jsonOverhead < 4_500_000);
});

// ───────────── pdf.js helpers (real PDFs, real pdf.js in Node) ─────────────

const loadNodePdfjs = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;

/** Hand-built one-page PDF with no text at all (a scan-like page: only a filled rectangle). */
function blankPdf(pages = 1): Buffer {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('pdf.js: text PDF yields text (→ "text" mode); a text-less PDF yields none (→ "scan" mode)', async () => {
  const pdfjs = await loadNodePdfjs();
  const doc = await openPdf(pdfjs, fixture('sample-bill.pdf'));
  const t = await extractPdfText(doc);
  assert.match(t.text, /Ada Lovelace|Amount due|Eko Electricity/i);
  assert.equal(t.pagesRead, 1);
  assert.equal(t.stoppedEarly, false);
  const textLen = normalizeText(t.text).length;
  assert.equal(decidePdfMode(textLen, 20), 'text');
  await doc.destroy?.();

  const blank = await openPdf(pdfjs, blankPdf(3));
  assert.equal(blank.numPages, 3);
  const bt = await extractPdfText(blank);
  assert.equal(decidePdfMode(normalizeText(bt.text).length), 'scan');
  await blank.destroy?.();
});

test('pdf.js: corrupt / non-PDF bytes → friendly PdfReadError (no raw pdf.js message)', async () => {
  const pdfjs = await loadNodePdfjs();
  await assert.rejects(openPdf(pdfjs, Buffer.from('%PDF-1.4 this is not really a pdf')), (e: any) => e instanceof PdfReadError && e.message === PDF_CORRUPT_MESSAGE);
  await assert.rejects(openPdf(pdfjs, Buffer.alloc(50, 7)), (e: any) => e instanceof PdfReadError);
  assert.equal(toPdfReadError({ name: 'PasswordException' }).message, PDF_PASSWORD_MESSAGE);
  assert.equal(toPdfReadError(new Error('Invalid PDF structure')).message, PDF_CORRUPT_MESSAGE);
});

test('extractPdfText: stops early once enough text was collected', async () => {
  let pagesAsked = 0;
  const doc: any = {
    numPages: 500,
    getPage: async (n: number) => { pagesAsked = n; return { getTextContent: async () => ({ items: [{ str: 'z'.repeat(1000), hasEOL: true }] }) }; },
  };
  const r = await extractPdfText(doc, 5_000);
  assert.ok(pagesAsked < 10, `read ${pagesAsked} pages`);
  assert.equal(r.stoppedEarly, true);
  // a failing page becomes a friendly error
  const bad: any = { numPages: 2, getPage: async () => { throw Object.assign(new Error('x'), { name: 'InvalidPDFException' }); } };
  await assert.rejects(extractPdfText(bad), PdfReadError);
});

// ───────────── prepareLargeFile (flow, with injected deps) ─────────────

const blob = (size: number, name = 'file') => {
  const b = new Blob([new Uint8Array(1)]);
  Object.defineProperty(b, 'size', { value: size });
  Object.defineProperty(b, 'name', { value: name });
  return b as Blob & { name: string; size: number };
};
const buf = async () => new ArrayBuffer(8);
function deps(over: Partial<PrepareDeps> = {}): PrepareDeps {
  return {
    readBuffer: buf,
    loadPdfjs: async () => ({}) as PdfjsLike,
    openPdf: async () => ({ numPages: 2, getPage: async () => { throw new Error('unused'); }, destroy: async () => {} }),
    extractPdfText: async () => ({ text: 'word '.repeat(200), stoppedEarly: false }),
    makePageRenderer: () => async (i) => fakeJpegDataUrl(1000 + i),
    extractDocx: async () => 'Invoice due 15/11/2026',
    extractSheet: async () => ({ text: '## Sheet: A\nx,y', sheetsTruncated: false }),
    extractPlain: async () => ({ text: 'a,b\n1,2', readAll: true }),
    ...over,
  };
}
const big = 4_000_000;

test('prepareLargeFile: small files and photos return null (normal upload path)', async () => {
  assert.equal(await prepareLargeFile(blob(1000), { kind: 'pdf', mime: 'application/pdf' }, deps()), null);
  assert.equal(await prepareLargeFile(blob(20_000_000), { kind: 'image', mime: 'image/jpeg' }, deps()), null);
});

test('prepareLargeFile: large PDF with enough text → text only, no file, no images', async () => {
  const r = await prepareLargeFile(blob(big, 'big.pdf'), { kind: 'pdf', mime: 'application/pdf' }, deps());
  assert.ok(r);
  assert.match(r!.documentText!, /^File name: big\.pdf\n\nDocument contents:\nword word/);
  assert.equal(r!.imageBase64, undefined);
  assert.equal(r!.pageImages, undefined);
  assert.equal(r!.notice, undefined);
});

test('prepareLargeFile: huge extracted PDF text is capped at ~60k chars and the user is told', async () => {
  const r = await prepareLargeFile(blob(big, 'b.pdf'), { kind: 'pdf', mime: 'application/pdf' }, deps({ extractPdfText: async () => ({ text: 'lorem ipsum '.repeat(20_000), stoppedEarly: false }) }));
  assert.ok(r!.documentText!.length <= MAX_CLIENT_TEXT_CHARS);
  assert.match(r!.notice!, /only the first part/i);
  const early = await prepareLargeFile(blob(big, 'b.pdf'), { kind: 'pdf', mime: 'application/pdf' }, deps({ extractPdfText: async () => ({ text: 'word '.repeat(200), stoppedEarly: true }) }));
  assert.match(early!.notice!, /only the first part/i);
});

test('prepareLargeFile: scanned PDF (little text) → first pages as images, with a "first pages only" notice', async () => {
  const asked: number[] = [];
  const r = await prepareLargeFile(blob(big, 'scan.pdf'), { kind: 'pdf', mime: 'application/pdf' }, deps({
    extractPdfText: async () => ({ text: '  12 \n', stoppedEarly: false }),
    openPdf: async () => ({ numPages: 40, getPage: async () => { throw new Error('unused'); } }),
    makePageRenderer: () => async (i) => { asked.push(i); return fakeJpegDataUrl(200_000); },
  }));
  assert.equal(r!.pageImages!.length, MAX_SCAN_PAGES);
  assert.deepEqual(asked, [0, 1, 2, 3, 4, 5]);
  assert.equal(r!.previewUrl, r!.pageImages![0]);
  assert.match(r!.notice!, /40 pages.*first 6 pages were read/);
  assert.match(r!.documentText!, /scan\.pdf/);
  assert.ok(totalBase64Length(r!.pageImages!) <= IMAGE_PAYLOAD_BUDGET_CHARS);
  // a short scan has no "only first pages" notice
  const short = await prepareLargeFile(blob(big), { kind: 'pdf', mime: 'application/pdf' }, deps({
    extractPdfText: async () => ({ text: '', stoppedEarly: false }),
    openPdf: async () => ({ numPages: 2, getPage: async () => { throw new Error('unused'); } }),
    makePageRenderer: () => async () => fakeJpegDataUrl(1000),
  }));
  assert.equal(short!.pageImages!.length, 2);
  assert.equal(short!.notice, undefined);
});

test('prepareLargeFile: large docx / xlsx / csv / txt → capped text only', async () => {
  const docx = await prepareLargeFile(blob(big, 'r.docx'), { kind: 'office', mime: DOCX_MIME }, deps());
  assert.match(docx!.documentText!, /File name: r\.docx[\s\S]*Invoice due 15\/11\/2026/);
  const xlsx = await prepareLargeFile(blob(big, 'r.xlsx'), { kind: 'office', mime: XLSX_MIME }, deps({ extractSheet: async () => ({ text: '## Sheet: A\nx', sheetsTruncated: true }) }));
  assert.match(xlsx!.documentText!, /## Sheet: A/);
  assert.match(xlsx!.notice!, /only the first part/i);
  const csv = await prepareLargeFile(blob(big, 'r.csv'), { kind: 'text', mime: 'text/csv' }, deps({ extractPlain: async () => ({ text: 'q'.repeat(100_000), readAll: true }) }));
  assert.ok(csv!.documentText!.length <= MAX_CLIENT_TEXT_CHARS);
  assert.match(csv!.notice!, /only the first part/i);
  const txt = await prepareLargeFile(blob(big, 'r.txt'), { kind: 'text', mime: 'text/plain' }, deps({ extractPlain: async () => ({ text: 'hello', readAll: false }) }));
  assert.match(txt!.notice!, /only the first part/i);
});

test('prepareLargeFile error paths: legacy .doc, corrupt PDF, unreadable docx, oversize scan — all friendly PrepareErrors', async () => {
  await assert.rejects(prepareLargeFile(blob(big, 'old.doc'), { kind: 'office', mime: DOC_MIME }, deps()), (e: any) => e instanceof PrepareError && /\.docx or PDF/.test(e.message));
  await assert.rejects(prepareLargeFile(blob(big), { kind: 'pdf', mime: 'application/pdf' }, deps({ openPdf: async () => { throw new PdfReadError(PDF_CORRUPT_MESSAGE); } })), (e: any) => e instanceof PrepareError && e.message === PDF_CORRUPT_MESSAGE);
  await assert.rejects(prepareLargeFile(blob(big), { kind: 'pdf', mime: 'application/pdf' }, deps({ loadPdfjs: async () => { throw new Error('chunk load failed: https://x/assets/pdf.js'); } })), (e: any) => e instanceof PrepareError && e.message.length > 5);
  await assert.rejects(prepareLargeFile(blob(big), { kind: 'office', mime: DOCX_MIME }, deps({ extractDocx: async () => { throw new Error('bad zip'); } })), PrepareError);
  await assert.rejects(prepareLargeFile(blob(big), { kind: 'pdf', mime: 'application/pdf' }, deps({
    extractPdfText: async () => ({ text: '', stoppedEarly: false }),
    makePageRenderer: () => async () => fakeJpegDataUrl(IMAGE_PAYLOAD_BUDGET_CHARS + 5),
  })), (e: any) => e instanceof PrepareError && /too large/i.test(e.message));
  // errors are never raw (no stack-like content)
  try { await prepareLargeFile(blob(big), { kind: 'office', mime: DOCX_MIME }, deps({ extractDocx: async () => { throw 'string thrown'; } })); assert.fail('should throw'); }
  catch (e: any) { assert.ok(e instanceof PrepareError); assert.doesNotMatch(e.message, /string thrown/); }
});

// ───────────── server: text-only and multi-image requests ─────────────

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF'), Buffer.alloc(41, 1)]).toString('base64'); // 51 bytes: no '=' padding
const jpegOfLength = (n: number) => JPEG_B64 + 'A'.repeat(Math.max(0, n - JPEG_B64.length)); // valid base64 of exactly n chars (n multiple of 4)

test('scan validation: text up to 60k chars is accepted, more is a 400', () => {
  assert.ok(validateScanRequest({ documentText: 'x'.repeat(MAX_TEXT_CHARS) }).ok);
  const r = validateScanRequest({ documentText: 'x'.repeat(MAX_TEXT_CHARS + 1) });
  assert.ok('error' in r && r.status === 400);
});

test('scan validation: pageImages accepted (prefix stripped, JPEG magic bytes required), shares one size budget with imageBase64', () => {
  const ok = validateScanRequest({ pageImages: ['data:image/jpeg;base64,' + JPEG_B64, JPEG_B64], documentText: 'scan.pdf' });
  assert.ok(ok.ok && ok.value.pageImages.length === 2 && ok.value.pageImages[0] === JPEG_B64);
  assert.ok(validateScanRequest({ pageImages: [JPEG_B64] }).ok, 'pages alone are a valid request');
  const cases: Array<[unknown, number]> = [
    [{ pageImages: 'x' }, 400], [{ pageImages: [5] }, 400], [{ pageImages: ['!!!'] }, 400],
    [{ pageImages: [Buffer.from('%PDF-1.4 not a jpeg at all').toString('base64')] }, 400],
    [{ pageImages: Array(MAX_PAGE_IMAGES + 1).fill(JPEG_B64) }, 400],
    [{ pageImages: [jpegOfLength(2_000_000), jpegOfLength(2_000_000), jpegOfLength(2_000_000)] }, 413],
    [{ imageBase64: jpegOfLength(3_000_000), mimeType: 'image/jpeg', pageImages: [jpegOfLength(1_500_000)] }, 413],
    [{ pageImages: [] }, 400], [{ pageImages: [''] }, 400],
  ];
  for (const [body, status] of cases) {
    const r = validateScanRequest(body);
    assert.ok('error' in r && r.status === status, `${JSON.stringify(body).slice(0, 60)} → ${'error' in r ? r.status + ' ' + r.error : 'ok'}`);
  }
  // exactly at the budget is fine
  assert.ok(validateScanRequest({ pageImages: [jpegOfLength(2_000_000), jpegOfLength(2_000_000)] }).ok);
  // a request built at the client budget (3.5 MB) is accepted
  assert.ok(validateScanRequest({ pageImages: [jpegOfLength(1_750_000), jpegOfLength(1_750_000)] }).ok);
});

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}
const post = (base: string, body: unknown) => fetch(base + '/api/scan-document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pushDeps = () => ({ store: new MemoryStore(), config: { publicKey: '', privateKey: '', subject: '', cronSecret: 's' } as any });
const modelReply = JSON.stringify({ hospitalName: 'Eko', patientName: 'Ada', patientMatch: 'Matches Profile: Self', diagnosis: 'Bill', appointmentDate: '15/11/2026', appointmentTime: '08:00 AM', eventTitle: 'Pay bill', shortNote: '', accuracy: 90, category: 'Bills & Invoices', extractedItems: [] });
const quiet = async <T>(fn: () => Promise<T>) => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };

test('HTTP scan: multi-image (scanned PDF pages) request reaches the model as ordered JPEG parts + a note', async () => {
  let seen: any;
  const app = createApiApp(pushDeps(), { getAi: () => ({ models: { generateContent: async (a: any) => { seen = a; return { text: modelReply }; } } }) as any });
  await withServer(app, async (base) => {
    const r = await post(base, { documentText: 'File name: scan.pdf', pageImages: ['data:image/jpeg;base64,' + JPEG_B64, JPEG_B64], userName: 'Ada' });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as any).success, true);
  });
  const parts = seen.contents.parts;
  assert.equal(parts.filter((p: any) => p.inlineData).length, 2);
  assert.ok(parts.filter((p: any) => p.inlineData).every((p: any) => p.inlineData.mimeType === 'image/jpeg' && p.inlineData.data === JPEG_B64));
  assert.match(parts[parts.length - 1].text, /2 attached images are the first pages/);
});

test('HTTP scan: text-only request (extracted text from a large file) works and is sent as prompt context', async () => {
  let seen: any;
  const app = createApiApp(pushDeps(), { getAi: () => ({ models: { generateContent: async (a: any) => { seen = a; return { text: modelReply }; } } }) as any });
  const text = 'File name: big.pdf\n\nDocument contents:\n' + 'Electric bill due 15/11/2026. '.repeat(1800);
  assert.ok(text.length > 20_000 && text.length <= 60_000);
  await withServer(app, async (base) => {
    const r = await post(base, { documentText: text, userName: 'Ada' });
    assert.equal(r.status, 200);
  });
  assert.equal(seen.contents.parts.filter((p: any) => p.inlineData).length, 0);
  assert.match(seen.contents.parts[0].text, /Electric bill due 15\/11\/2026/);
});

test('HTTP scan: invalid page images / oversize bodies are refused before the model (honest 400/413)', async () => {
  let calls = 0;
  const app = createApiApp(pushDeps(), { getAi: () => ({ models: { generateContent: async () => { calls++; return { text: modelReply }; } } }) as any });
  await quiet(() => withServer(app, async (base) => {
    assert.equal((await post(base, { pageImages: ['!!!'] })).status, 400);
    assert.equal((await post(base, { pageImages: [jpegOfLength(2_500_000), jpegOfLength(2_500_000)] })).status, 413);
    const huge = await post(base, { documentText: 'x', pageImages: [], padding: 'A'.repeat(4_600_000) });
    assert.equal(huge.status, 413, 'total body cap (4.5 MB) is enforced by the parser');
    assert.equal(((await huge.json()) as any).success, false);
  }));
  assert.equal(calls, 0);
});

test('HTTP scan: rate limit still applies to text-only / page-image requests', async () => {
  const app = createApiApp(pushDeps(), { scanRateLimit: { windowMs: 60_000, max: 2 }, getAi: () => ({ models: { generateContent: async () => ({ text: modelReply }) } }) as any });
  await withServer(app, async (base) => {
    assert.equal((await post(base, { documentText: 'a bill' })).status, 200);
    assert.equal((await post(base, { pageImages: [JPEG_B64] })).status, 200);
    const third = await post(base, { documentText: 'again' });
    assert.equal(third.status, 429);
  });
});
