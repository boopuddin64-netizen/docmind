/**
 * Strict input validation for POST /api/scan-document. Pure (no Express / Gemini) so it can be unit-tested.
 */

/** Max size of the base64 payload (chars). Vercel rejects bodies above 4.5 MB anyway; stay safely under it. */
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_NAME_CHARS = 200;
export const MAX_FAMILY_MEMBERS = 50;
export const ALLOWED_SCAN_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
];

export interface ScanInput {
  documentText: string;
  /** Raw base64 (any "data:...;base64," prefix removed); empty string when no image was supplied. */
  imageBase64: string;
  mimeType: string;
  userName: string;
  /** Registered profile names (family members) as plain strings. */
  familyNames: string[];
}

export type ScanValidation =
  | { ok: true; value: ScanInput }
  | { ok: false; status: 400 | 413; error: string };

/** Magic-number check so junk / corrupt uploads are refused before spending a model call. */
export function looksLikeFileType(base64: string, mimeType: string): boolean {
  let head: Buffer;
  try { head = Buffer.from(base64.slice(0, 48), 'base64'); } catch { return false; }
  if (head.length < 8) return false;
  const ascii = (a: number, b: number) => head.subarray(a, b).toString('latin1');
  switch (mimeType) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic':
    case 'image/heif': return ascii(4, 8) === 'ftyp';
    case 'application/pdf': return ascii(0, 4) === '%PDF';
    default: return true;
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
    const mt = body.mimeType.toLowerCase().trim();
    if (!ALLOWED_SCAN_MIME_TYPES.includes(mt)) return bad('Unsupported mimeType.');
    mimeType = mt;
  }

  let imageBase64 = '';
  if (body.imageBase64 !== undefined && body.imageBase64 !== null) {
    if (typeof body.imageBase64 !== 'string') return bad('imageBase64 must be a string.');
    // Check the raw length first so an oversized payload is rejected before any regex work.
    if (body.imageBase64.length > MAX_IMAGE_BASE64_CHARS + 200) return bad('Image is too large. Please use a smaller image.', 413);
    imageBase64 = body.imageBase64.replace(/^data:[^;,]+;base64,/, '').trim();
    if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) return bad('Image is too large. Please use a smaller image.', 413);
    if (imageBase64 && !BASE64_RE.test(imageBase64)) return bad('imageBase64 is not valid base64 data.');
    if (imageBase64 && !looksLikeFileType(imageBase64, mimeType)) return bad('The file is not a valid image or is corrupt. Please try another one.');
  }

  if (!imageBase64 && !documentText.trim()) return bad('Provide a non-empty image or document text to scan.');

  return { ok: true, value: { documentText, imageBase64, mimeType, userName, familyNames } };
}
