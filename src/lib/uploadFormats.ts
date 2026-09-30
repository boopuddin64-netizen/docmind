/**
 * Single source of truth for which upload formats DocuMind can scan. Pure (no DOM / Node APIs) so both the browser
 * (file picker, pre-flight checks) and the server (validation) share it and it can be unit-tested.
 */

/** How the server hands a file to the model: images/PDF go inline; Office and text formats are turned into text first. */
export type UploadKind = 'image' | 'pdf' | 'office' | 'text';

export interface UploadFormat {
  ext: string;
  mime: string;
  kind: UploadKind;
  label: string;
}

export const UPLOAD_FORMATS: readonly UploadFormat[] = [
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image', label: 'JPG' },
  { ext: 'jpeg', mime: 'image/jpeg', kind: 'image', label: 'JPG' },
  { ext: 'png', mime: 'image/png', kind: 'image', label: 'PNG' },
  { ext: 'webp', mime: 'image/webp', kind: 'image', label: 'WebP' },
  { ext: 'heic', mime: 'image/heic', kind: 'image', label: 'HEIC' },
  { ext: 'heif', mime: 'image/heif', kind: 'image', label: 'HEIF' },
  { ext: 'pdf', mime: 'application/pdf', kind: 'pdf', label: 'PDF' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office', label: 'Word' },
  { ext: 'doc', mime: 'application/msword', kind: 'office', label: 'Word' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'office', label: 'Excel' },
  { ext: 'xls', mime: 'application/vnd.ms-excel', kind: 'office', label: 'Excel' },
  { ext: 'csv', mime: 'text/csv', kind: 'text', label: 'CSV' },
  { ext: 'txt', mime: 'text/plain', kind: 'text', label: 'Text' },
];

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOC_MIME = 'application/msword';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const XLS_MIME = 'application/vnd.ms-excel';

/** Every MIME type the scan endpoint accepts. */
export const SUPPORTED_MIME_TYPES: readonly string[] = Array.from(new Set(UPLOAD_FORMATS.map((f) => f.mime)));

/** Value for <input type="file" accept="...">: extensions AND MIME types so every OS picker offers the documents. */
export const FILE_INPUT_ACCEPT = ['image/*', ...UPLOAD_FORMATS.filter((f) => f.kind !== 'image').map((f) => `.${f.ext}`)].join(',');

/**
 * Largest raw file (bytes) we upload as-is. Vercel rejects request bodies above ~4.5 MB and base64 adds a third,
 * so 3 MB of file becomes ~4 MB of base64 (see MAX_IMAGE_BASE64_CHARS on the server). Bigger files are handled in the
 * browser first (see largeFile.ts): text is extracted, scanned PDFs become a few page images, photos are downscaled.
 */
export const MAX_UPLOAD_FILE_BYTES = 3_000_000;

/** Hard client-side limit for ANY file (bytes). Bigger files are refused with a friendly message. */
export const MAX_HARD_FILE_BYTES = 50_000_000;

export const SUPPORTED_FORMATS_TEXT = 'JPG, PNG, WebP, PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV or TXT';

export const kindOfMime = (mime: string): UploadKind | undefined => UPLOAD_FORMATS.find((f) => f.mime === mime)?.kind;

const extOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
};

/**
 * Works out the MIME type to send. Browsers report wrong or empty types for documents (e.g. "" for .doc on some
 * systems, application/vnd.ms-excel for .csv on Windows), so a known extension wins over the reported type.
 */
export function resolveUploadMime(file: { name: string; type?: string }): string | undefined {
  const byExt = UPLOAD_FORMATS.find((f) => f.ext === extOf(file.name));
  if (byExt) return byExt.mime;
  const type = (file.type || '').toLowerCase().split(';')[0].trim();
  if (type.startsWith('image/') && SUPPORTED_MIME_TYPES.includes(type)) return type;
  return SUPPORTED_MIME_TYPES.includes(type) ? type : undefined;
}

export type UploadCheck =
  | { ok: true; mime: string; kind: UploadKind }
  | { ok: false; error: string };

/**
 * Pre-flight check in the browser: supported type, not empty and under the hard limit. Files above
 * MAX_UPLOAD_FILE_BYTES are NOT rejected here; largeFile.ts decides how to shrink them.
 */
export function checkUploadFile(file: { name: string; type?: string; size: number }): UploadCheck {
  const mime = resolveUploadMime(file);
  if (!mime) return { ok: false, error: `That file type is not supported. Please choose ${SUPPORTED_FORMATS_TEXT}.` };
  const kind = kindOfMime(mime)!;
  if (!(file.size > 0)) return { ok: false, error: 'That file is empty. Please choose another one.' };
  if (file.size > MAX_HARD_FILE_BYTES) {
    const mb = (MAX_HARD_FILE_BYTES / 1_000_000).toFixed(0);
    return { ok: false, error: `That file is too large (limit ${mb} MB). Try a smaller file, or export just the pages you need.` };
  }
  return { ok: true, mime, kind };
}

/** Strips a "data:...;base64," prefix. */
export const stripDataUrlPrefix = (dataUrl: string): string => dataUrl.replace(/^data:[^;,]+;base64,/, '');

/** Builds the "data:<mime>;base64,<payload>" string the scan request sends, forcing the resolved MIME type. */
export const toDataUrl = (base64OrDataUrl: string, mime: string): string => `data:${mime};base64,${stripDataUrlPrefix(base64OrDataUrl)}`;
