/**
 * Pure helpers for files that are too big to upload as-is (Vercel rejects request bodies above ~4.5 MB and base64 adds a
 * third). No DOM / Node APIs and no heavy libraries here, so this stays in the main bundle and is unit-testable.
 * The heavy work (pdfjs, mammoth, SheetJS) lives in pdfClient.ts / officeClient.ts and is loaded on demand.
 */
import { MAX_UPLOAD_FILE_BYTES, DOC_MIME, type UploadKind } from './uploadFormats';

/** Files above this many bytes are shrunk in the browser first (same as the "send as-is" limit). */
export const LARGE_FILE_THRESHOLD_BYTES = MAX_UPLOAD_FILE_BYTES;
/** Text sent instead of a large document is capped so one huge file can not blow the prompt / request size. */
export const MAX_CLIENT_TEXT_CHARS = 60_000;
/** A PDF with fewer extractable characters than this is treated as a scan and sent as page images. */
export const MIN_PDF_TEXT_CHARS = 300;
/** Scanned PDFs: at most this many pages are rendered and sent. */
export const MAX_SCAN_PAGES = 6;
/** Scanned PDFs: longest side of each rendered page (px) and first JPEG quality. */
export const SCAN_PAGE_MAX_DIMENSION = 1400;
export const SCAN_PAGE_QUALITY = 0.7;
/** Total base64 characters of all images in one request. The server allows 4 MB; stay safely below it. */
export const IMAGE_PAYLOAD_BUDGET_CHARS = 3_500_000;
/** Text extraction stops early once this many pages of a PDF were read (huge scanned PDFs would otherwise take ages). */
export const MAX_PDF_TEXT_PAGES = 200;

export type LargeFilePlan =
  | { action: 'inline' } // small enough: upload the file itself, the server reads it
  | { action: 'downscale-image' } // photos are always re-encoded as a <=1600px JPEG
  | { action: 'pdf' } // extract text, else render the first pages
  | { action: 'docx' | 'sheet' | 'plain-text' }
  | { action: 'unsupported'; error: string };

export const LEGACY_DOC_MESSAGE =
  'This large Word file is in the older .doc format, which can not be read in the browser. Please save it as .docx or PDF (File → Save As) and upload that instead.';

/** Decides how a file is handled from its kind, resolved MIME type and size. Pure. */
export function planUpload(file: { kind: UploadKind; mime: string; size: number }): LargeFilePlan {
  if (file.kind === 'image') return { action: 'downscale-image' };
  if (file.size <= LARGE_FILE_THRESHOLD_BYTES) return { action: 'inline' };
  if (file.kind === 'pdf') return { action: 'pdf' };
  if (file.kind === 'text') return { action: 'plain-text' };
  if (file.mime === DOC_MIME) return { action: 'unsupported', error: LEGACY_DOC_MESSAGE };
  if (file.mime.includes('wordprocessingml')) return { action: 'docx' };
  return { action: 'sheet' };
}

/** How a PDF is sent, given how much text could be extracted from it. */
export function decidePdfMode(extractedTextChars: number, minChars = MIN_PDF_TEXT_CHARS): 'text' | 'scan' {
  return extractedTextChars > minChars ? 'text' : 'scan';
}

/** Collapses whitespace runs (keeping paragraph breaks) and trims. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Normalises then caps text. `truncated` tells the UI that only the first part is sent. */
export function capText(text: string, max = MAX_CLIENT_TEXT_CHARS): { text: string; truncated: boolean } {
  const t = normalizeText(text);
  if (t.length <= max) return { text: t, truncated: false };
  // Do not cut a surrogate pair in half.
  let end = max;
  const last = t.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: t.slice(0, end), truncated: true };
}

/**
 * Builds the documentText for a text-only request: the file name first (so the model has context), then the contents,
 * capped as a whole so the request stays small.
 */
export function buildTextPayload(fileName: string, contents: string, max = MAX_CLIENT_TEXT_CHARS): { documentText: string; truncated: boolean } {
  const name = fileName.replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
  const header = `${name ? `File name: ${name}\n\n` : ''}Document contents:\n`;
  const body = capText(contents, Math.max(0, max - header.length));
  return { documentText: header + body.text, truncated: body.truncated };
}

/** Length of the base64 payload of a data URL (or of bare base64). */
export const base64Length = (dataUrlOrBase64: string): number => dataUrlOrBase64.replace(/^data:[^;,]+;base64,/, '').length;

export const totalBase64Length = (images: readonly string[]): number => images.reduce((n, i) => n + base64Length(i), 0);

export interface RenderOptions { maxDimension: number; quality: number }
/** Renders 0-based page `index` as a JPEG data URL. */
export type PageRenderer = (index: number, opts: RenderOptions) => Promise<string>;

/** Quality/size ladder tried in order until the pages fit the budget; the first rung is the requested setting. */
export const RENDER_LADDER: readonly RenderOptions[] = [
  { maxDimension: SCAN_PAGE_MAX_DIMENSION, quality: SCAN_PAGE_QUALITY },
  { maxDimension: 1400, quality: 0.55 },
  { maxDimension: 1200, quality: 0.5 },
  { maxDimension: 1000, quality: 0.45 },
  { maxDimension: 800, quality: 0.4 },
];

export interface FittedPages {
  images: string[];
  pagesRead: number;
  totalPages: number;
  /** True when fewer pages than the document has are included (page limit or budget). */
  partial: boolean;
  options: RenderOptions;
  totalChars: number;
}

export class PayloadTooLargeError extends Error {
  constructor(message = 'The pages of this scan are too large to send even after shrinking them. Try a smaller file, or export just the pages you need.') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Renders the first pages of a scanned document within the payload budget: tries the ladder (lower quality / smaller
 * pages) with all wanted pages first, then drops trailing pages, always keeping at least page 1. Throws
 * PayloadTooLargeError when even one page at the lowest rung does not fit.
 */
export async function fitPagesToBudget(
  render: PageRenderer,
  totalPages: number,
  opts: { maxPages?: number; budgetChars?: number; ladder?: readonly RenderOptions[] } = {},
): Promise<FittedPages> {
  const budget = opts.budgetChars ?? IMAGE_PAYLOAD_BUDGET_CHARS;
  const ladder = opts.ladder ?? RENDER_LADDER;
  const wanted = Math.max(0, Math.min(totalPages, opts.maxPages ?? MAX_SCAN_PAGES));
  if (wanted < 1 || ladder.length === 0) throw new PayloadTooLargeError('This PDF has no pages to read.');

  let last: { images: string[]; options: RenderOptions } | null = null;
  for (const options of ladder) {
    const images: string[] = [];
    for (let i = 0; i < wanted; i++) images.push(await render(i, options));
    last = { images, options };
    if (totalBase64Length(images) <= budget) return finish(images, options);
  }
  // Even the smallest rung is too big with all pages: drop pages from the end (keep page 1).
  const { images, options } = last!;
  while (images.length > 1 && totalBase64Length(images) > budget) images.pop();
  if (totalBase64Length(images) > budget) throw new PayloadTooLargeError();
  return finish(images, options);

  function finish(imgs: string[], options: RenderOptions): FittedPages {
    return { images: imgs, pagesRead: imgs.length, totalPages, partial: imgs.length < totalPages, options, totalChars: totalBase64Length(imgs) };
  }
}

/** Quality/size ladder for a single (large) photo whose first encoding is still over budget. */
export const PHOTO_LADDER: readonly RenderOptions[] = [
  { maxDimension: 1600, quality: 0.8 },
  { maxDimension: 1400, quality: 0.65 },
  { maxDimension: 1200, quality: 0.5 },
  { maxDimension: 1000, quality: 0.4 },
];

/** Encodes one image, walking down PHOTO_LADDER until it fits the budget. Throws PayloadTooLargeError if nothing fits. */
export async function fitImageToBudget(
  encode: (opts: RenderOptions) => Promise<string>,
  budgetChars = IMAGE_PAYLOAD_BUDGET_CHARS,
  ladder: readonly RenderOptions[] = PHOTO_LADDER,
): Promise<string> {
  for (const options of ladder) {
    const out = await encode(options);
    if (base64Length(out) <= budgetChars) return out;
  }
  throw new PayloadTooLargeError('That photo is too detailed to send even after shrinking it. Please try a smaller photo.');
}

/** User-facing note when only the first pages of a scanned PDF were read (empty string when everything was read). */
export function partialPagesNotice(pagesRead: number, totalPages: number): string {
  if (pagesRead >= totalPages) return '';
  return `This large scanned PDF has ${totalPages} pages. Only the first ${pagesRead} ${pagesRead === 1 ? 'page was' : 'pages were'} read, so items on later pages may be missing.`;
}

export const TRUNCATED_TEXT_NOTICE = 'This file is large, so only the first part of its text was read. Items further into the file may be missing.';
