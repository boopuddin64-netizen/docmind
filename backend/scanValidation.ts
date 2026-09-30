import { SUPPORTED_MIME_TYPES, DOCX_MIME, DOC_MIME, XLSX_MIME, XLS_MIME } from '../src/lib/uploadFormats.js';

/**
 * Strict input validation for POST /api/scan-document. Pure (no Express / Gemini) so it can be unit-tested.
 */

/** Max size of the base64 payload (chars). Vercel rejects bodies above 4.5 MB anyway; stay safely under it. */
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;
export const TOO_LARGE_MESSAGE = 'That file is too large to upload (limit about 3 MB). Please use a smaller file.';
/**
 * documentText: a pasted note, a file name, or (for large files) text the browser extracted itself, so it matches the
 * browser's cap (MAX_CLIENT_TEXT_CHARS = 60,000).
 */
export const MAX_TEXT_CHARS = 60_000;
/** Scanned PDFs arrive as several page images (JPEG); at most this many per request. */
export const MAX_PAGE_IMAGES = 8;
export const MAX_NAME_CHARS = 200;
export const MAX_FAMILY_MEMBERS = 50;
/** Images and PDF (sent to the model inline) plus Word / Excel / CSV / TXT (turned into text on the server). */
export const ALLOWED_SCAN_MIME_TYPES: readonly string[] = SUPPORTED_MIME_TYPES;

export interface ScanInput {
  documentText: string;
  /** Raw base64 (any "data:...;base64," prefix removed); empty string when no image was supplied. */
  imageBase64: string;
  mimeType: string;
  /** Raw base64 JPEG pages of one scanned document (empty array when none). Counted against MAX_IMAGE_BASE64_CHARS together with imageBase64. */
  pageImages: string[];
  userName: string;
  /** Registered profile names (family members) as plain strings. */
  familyNames: string[];
}

export type ScanValidation =
  | { ok: true; value: ScanInput }
  | { ok: false; status: 400 | 413; error: string };

/** Message shown when the bytes do not match the declared type. */
export const CORRUPT_FILE_MESSAGE = 'The file is not a valid document of that type or is corrupt. Please try another one.';

/**
 * Magic-number check so junk / corrupt / mislabelled uploads are refused before spending a model call.
 *  - PDF: "%PDF" at the very start of the file.
 *  - DOCX / XLSX: ZIP container "PK\x03\x04" (empty archives "PK\x05\x06" are not documents).
 *  - Legacy DOC / XLS: OLE2 compound file D0 CF 11 E0 A1 B1 1A E1.
 *  - CSV / TXT: must look like text (no NUL bytes / binary headers of the other formats).
 */
export function looksLikeFileType(base64: string, mimeType: string): boolean {
  let head: Buffer;
  try { head = Buffer.from(base64.slice(0, 48), 'base64'); } catch { return false; }
  const ascii = (a: number, b: number) => head.subarray(a, b).toString('latin1');
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    if (head.length === 0) return false;
    if (head.includes(0)) return false; // NUL bytes: binary, not text (also UTF-16 which the model path can not use)
    return !(ascii(0, 4) === '%PDF' || (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03) || (head[0] === 0xd0 && head[1] === 0xcf));
  }
  if (head.length < 8) return false;
  switch (mimeType) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic':
    case 'image/heif': return ascii(4, 8) === 'ftyp';
    case 'application/pdf': return ascii(0, 4) === '%PDF';
    case DOCX_MIME:
    case XLSX_MIME: return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    case DOC_MIME:
    case XLS_MIME: return head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1;
    default: return false;
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (error: string, status: 400 | 413 = 400): ScanValidation => ({ ok: false, status, error });

export function validateScanRequest(body: unknown): ScanValidation {
  if (!isRecord(body)) return bad('Request body must be a JSON object.');

  let documentText = '';
  if (body.documentText !== undefined && body.documentText !== null) {
    if (typeof body.documentText !== 'string') return bad('documentText must be a string.');
    if (body.documentText.length > MAX_TEXT_CHARS) return bad(`documentText must be at most ${MAX_TEXT_CHARS} characters.`);
    documentText = body.documentText;
  }

  let userName = 'User Account';
  if (body.userName !== undefined && body.userName !== null) {
    if (typeof body.userName !== 'string') return bad('userName must be a string.');
    if (body.userName.length > MAX_NAME_CHARS) return bad(`userName must be at most ${MAX_NAME_CHARS} characters.`);
    if (body.userName.trim()) userName = body.userName.trim();
  }

  const familyNames: string[] = [];
  if (body.familyMembers !== undefined && body.familyMembers !== null) {
    if (!Array.isArray(body.familyMembers)) return bad('familyMembers must be an array.');
    if (body.familyMembers.length > MAX_FAMILY_MEMBERS) return bad(`familyMembers may contain at most ${MAX_FAMILY_MEMBERS} entries.`);
    for (const m of body.familyMembers) {
      if (!isRecord(m) || typeof m.name !== 'string') return bad('Each familyMembers entry must be an object with a string name.');
      if (m.name.length > MAX_NAME_CHARS) return bad(`Family member names must be at most ${MAX_NAME_CHARS} characters.`);
      if (m.name.trim()) familyNames.push(m.name.trim());
    }
  }

  let mimeType = 'image/jpeg';
  if (body.mimeType !== undefined && body.mimeType !== null) {
    if (typeof body.mimeType !== 'string') return bad('mimeType must be a string.');
    const mt = body.mimeType.toLowerCase().split(';')[0].trim();
    if (!ALLOWED_SCAN_MIME_TYPES.includes(mt)) return bad('Unsupported file type. Please upload an image, PDF, Word, Excel, CSV or text file.');
    mimeType = mt;
  }

  let imageBase64 = '';
  if (body.imageBase64 !== undefined && body.imageBase64 !== null) {
    if (typeof body.imageBase64 !== 'string') return bad('imageBase64 must be a string.');
    // Check the raw length first so an oversized payload is rejected before any regex work.
    if (body.imageBase64.length > MAX_IMAGE_BASE64_CHARS + 200) return bad(TOO_LARGE_MESSAGE, 413);
    imageBase64 = body.imageBase64.replace(/^data:[^;,]+;base64,/, '').trim();
    if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) return bad(TOO_LARGE_MESSAGE, 413);
    if (imageBase64 && !BASE64_RE.test(imageBase64)) return bad('imageBase64 is not valid base64 data.');
    if (imageBase64 && !looksLikeFileType(imageBase64, mimeType)) return bad(CORRUPT_FILE_MESSAGE);
  }

  const pageImages: string[] = [];
  if (body.pageImages !== undefined && body.pageImages !== null) {
    if (!Array.isArray(body.pageImages)) return bad('pageImages must be an array.');
    if (body.pageImages.length > MAX_PAGE_IMAGES) return bad(`pageImages may contain at most ${MAX_PAGE_IMAGES} images.`);
    // One shared budget for every image in the request, so the total body stays under the platform limit.
    let total = imageBase64.length;
    for (const raw of body.pageImages) {
      if (typeof raw !== 'string') return bad('Each page image must be a base64 string.');
      total += raw.length;
      if (total > MAX_IMAGE_BASE64_CHARS + 200 * (body.pageImages.length + 1)) return bad(TOO_LARGE_MESSAGE, 413);
      const b64 = raw.replace(/^data:[^;,]+;base64,/, '').trim();
      if (!b64) continue;
      if (!BASE64_RE.test(b64)) return bad('A page image is not valid base64 data.');
      if (!looksLikeFileType(b64, 'image/jpeg')) return bad(CORRUPT_FILE_MESSAGE);
      pageImages.push(b64);
    }
    if (imageBase64.length + pageImages.reduce((n, i) => n + i.length, 0) > MAX_IMAGE_BASE64_CHARS) return bad(TOO_LARGE_MESSAGE, 413);
  }

  if (!imageBase64 && pageImages.length === 0 && !documentText.trim()) return bad('Provide a non-empty image or document text to scan.');

  return { ok: true, value: { documentText, imageBase64, mimeType, pageImages, userName, familyNames } };
}
