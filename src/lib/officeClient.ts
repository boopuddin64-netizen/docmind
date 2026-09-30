import { ScanError, isDynamicImportFailure, networkError } from './scanErrors';

/**
 * Browser-side text extraction for large Word / Excel / CSV / TXT files. mammoth (browser build) and SheetJS are loaded
 * on demand with dynamic import(), so they are not part of the main bundle.
 */

export const OFFICE_UNREADABLE_MESSAGE = 'We could not open that document. It may be corrupt or password-protected. Try re-saving it or exporting it as PDF.';
export const OFFICE_EMPTY_MESSAGE = 'We could not find any text in that document. If it only contains pictures, upload a photo or PDF of it instead.';
export const NOT_TEXT_MESSAGE = 'That file does not look like a plain text or CSV file. Please choose another one.';

/** User-facing failure while reading a document in the browser. */
export class OfficeReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeReadError';
  }
}

const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 2_000;
/** Plain text: only this many bytes are read (60k chars is at most ~240 KB of UTF-8), so a 50 MB log file does not fill memory. */
export const PLAIN_TEXT_READ_BYTES = 400_000;

export async function extractDocxText(data: ArrayBuffer): Promise<string> {
  let text: string;
  try {
    const mammoth = (await import('mammoth/mammoth.browser.min.js')).default;
    text = (await mammoth.extractRawText({ arrayBuffer: data })).value;
  } catch (e) {
    if (isDynamicImportFailure(e)) throw networkError('chunk'); // the reader could not be downloaded: a connection problem, not a bad file
    console.warn('docx read failed', e);
    throw new OfficeReadError(OFFICE_UNREADABLE_MESSAGE);
  }
  if (!text.trim()) throw new OfficeReadError(OFFICE_EMPTY_MESSAGE);
  return text;
}

/** xlsx / xls / csv → "## Sheet: name" + CSV per sheet. `sheetsTruncated` is true when rows or sheets were skipped. */
export async function extractSheetText(data: ArrayBuffer): Promise<{ text: string; sheetsTruncated: boolean }> {
  let XLSX: typeof import('xlsx');
  try { XLSX = await import('xlsx'); } catch (e) {
    if (isDynamicImportFailure(e)) throw networkError('chunk');
    console.warn('xlsx load failed', e);
    throw new OfficeReadError(OFFICE_UNREADABLE_MESSAGE);
  }
  try {
    const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true, sheetRows: MAX_ROWS_PER_SHEET + 1 });
    const out: string[] = [];
    let sheetsTruncated = wb.SheetNames.length > MAX_SHEETS;
    for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const full = (sheet as any)['!fullref'] as string | undefined;
      if (full) {
        const r = XLSX.utils.decode_range(full);
        if (r.e.r - r.s.r + 1 > MAX_ROWS_PER_SHEET) sheetsTruncated = true;
      }
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, dateNF: 'dd/mm/yyyy' }).trim();
      if (csv.replace(/[,\s]/g, '')) out.push(`## Sheet: ${name}\n${csv}`);
    }
    const text = out.join('\n\n');
    if (!text.trim()) throw new OfficeReadError(OFFICE_EMPTY_MESSAGE);
    return { text, sheetsTruncated };
  } catch (e) {
    if (e instanceof OfficeReadError || e instanceof ScanError) throw e;
    console.warn('sheet read failed', e);
    throw new OfficeReadError(OFFICE_UNREADABLE_MESSAGE);
  }
}

/** Plain text / CSV: reads only the first PLAIN_TEXT_READ_BYTES. Binary content (NUL bytes) is refused. */
export async function extractPlainText(file: Blob): Promise<{ text: string; readAll: boolean }> {
  let text: string;
  try {
    text = await file.slice(0, PLAIN_TEXT_READ_BYTES).text();
  } catch {
    throw new OfficeReadError('That file could not be read. Please choose another one.');
  }
  if (text.includes('\u0000')) throw new OfficeReadError(NOT_TEXT_MESSAGE);
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new OfficeReadError(OFFICE_EMPTY_MESSAGE);
  return { text, readAll: file.size <= PLAIN_TEXT_READ_BYTES };
}
