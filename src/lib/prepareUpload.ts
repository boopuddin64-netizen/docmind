/**
 * Turns a user-picked file into a small scan request payload. Files up to 3 MB (and all photos) keep the existing path;
 * larger PDF / Word / Excel / CSV / TXT files are read IN THE BROWSER so only extracted text (or a few page images)
 * is uploaded, staying far below Vercel's ~4.5 MB request-body limit. Heavy libraries are loaded on demand.
 */
import {
  LARGE_FILE_THRESHOLD_BYTES,
  MAX_CLIENT_TEXT_CHARS,
  MAX_SCAN_PAGES,
  TRUNCATED_TEXT_NOTICE,
  buildTextPayload,
  decidePdfMode,
  fitPagesToBudget,
  normalizeText,
  partialPagesNotice,
  planUpload,
  type PageRenderer,
} from './largeFile';
import type { PdfDocLike, PdfjsLike } from './pdfClient';
import type { UploadKind } from './uploadFormats';

/** What the scan request needs (all optional; the server requires at least one of text / image / pages). */
export interface PreparedScan {
  documentText?: string;
  /** Data URL of a single file/image. */
  imageBase64?: string;
  mimeType?: string;
  /** JPEG data URLs of the first pages of a scanned PDF. */
  pageImages?: string[];
  /** Shown to the user (partial read etc.). */
  notice?: string;
  /** Data URL for the preview thumbnail, when there is one. */
  previewUrl?: string;
}

/** A failure whose message is safe to show as-is. */
export class PrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrepareError';
  }
}

/** Everything environment-specific (heavy libs, canvas) is injectable so the flow can be tested without a browser. */
export interface PrepareDeps {
  readBuffer(file: Blob): Promise<ArrayBuffer>;
  loadPdfjs(): Promise<PdfjsLike>;
  openPdf(pdfjs: PdfjsLike, data: ArrayBuffer): Promise<PdfDocLike>;
  extractPdfText(doc: PdfDocLike): Promise<{ text: string; stoppedEarly: boolean }>;
  makePageRenderer(doc: PdfDocLike): PageRenderer;
  extractDocx(data: ArrayBuffer): Promise<string>;
  extractSheet(data: ArrayBuffer): Promise<{ text: string; sheetsTruncated: boolean }>;
  extractPlain(file: Blob): Promise<{ text: string; readAll: boolean }>;
}

/** Real dependencies: each import() is a separate lazy chunk. */
export const defaultDeps: PrepareDeps = {
  readBuffer: (file) => file.arrayBuffer(),
  loadPdfjs: async () => (await import('./pdfjsLoader')).loadPdfjs(),
  openPdf: async (pdfjs, data) => (await import('./pdfClient')).openPdf(pdfjs, data),
  extractPdfText: async (doc) => (await import('./pdfClient')).extractPdfText(doc),
  makePageRenderer: (doc) => {
    // Renderer is created lazily on first call so pdfClient stays in its own chunk.
    let inner: PageRenderer | null = null;
    return async (i, o) => {
      inner ??= (await import('./pdfClient')).makePageRenderer(doc);
      return inner(i, o);
    };
  },
  extractDocx: async (data) => (await import('./officeClient')).extractDocxText(data),
  extractSheet: async (data) => (await import('./officeClient')).extractSheetText(data),
  extractPlain: async (file) => (await import('./officeClient')).extractPlainText(file),
};

const errMessage = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'That file could not be read. Please choose another one.');

/**
 * Prepares a LARGE non-image file (see planUpload). Returns null when the file is small enough to be uploaded as-is
 * (caller keeps the normal path). Throws PrepareError with a friendly message otherwise.
 */
export async function prepareLargeFile(
  file: { name: string; size: number } & Blob,
  info: { kind: UploadKind; mime: string },
  deps: PrepareDeps = defaultDeps,
): Promise<PreparedScan | null> {
  const plan = planUpload({ kind: info.kind, mime: info.mime, size: file.size });
  switch (plan.action) {
    case 'inline':
    case 'downscale-image':
      return null;
    case 'unsupported':
      throw new PrepareError(plan.error);
    default:
  }

  try {
    if (plan.action === 'pdf') return await preparePdf(file, deps);

    let contents: string;
    let truncated = false;
    if (plan.action === 'plain-text') {
      const r = await deps.extractPlain(file);
      contents = r.text;
      truncated = !r.readAll;
    } else if (plan.action === 'docx') {
      contents = await deps.extractDocx(await deps.readBuffer(file));
    } else {
      const r = await deps.extractSheet(await deps.readBuffer(file));
      contents = r.text;
      truncated = r.sheetsTruncated;
    }
    const built = buildTextPayload(file.name, contents, MAX_CLIENT_TEXT_CHARS);
    return {
      documentText: built.documentText,
      notice: truncated || built.truncated ? TRUNCATED_TEXT_NOTICE : undefined,
    };
  } catch (e) {
    if (e instanceof PrepareError) throw e;
    // OfficeReadError / PdfReadError / PayloadTooLargeError all carry user-safe messages.
    throw new PrepareError(errMessage(e));
  }
}

async function preparePdf(file: Blob & { name: string }, deps: PrepareDeps): Promise<PreparedScan> {
  const pdfjs = await deps.loadPdfjs();
  const doc = await deps.openPdf(pdfjs, await deps.readBuffer(file));
  try {
    const { text, stoppedEarly } = await deps.extractPdfText(doc);
    const clean = normalizeText(text);
    if (decidePdfMode(clean.length) === 'text') {
      const built = buildTextPayload(file.name, clean, MAX_CLIENT_TEXT_CHARS);
      return { documentText: built.documentText, notice: built.truncated || stoppedEarly ? TRUNCATED_TEXT_NOTICE : undefined };
    }
    // Scanned PDF: send the first pages as images.
    const fitted = await fitPagesToBudget(deps.makePageRenderer(doc), doc.numPages, { maxPages: MAX_SCAN_PAGES });
    return {
      documentText: `File name: ${file.name.replace(/[\r\n]+/g, ' ').slice(0, 150)}`,
      pageImages: fitted.images,
      previewUrl: fitted.images[0],
      notice: partialPagesNotice(fitted.pagesRead, fitted.totalPages) || undefined,
    };
  } finally {
    void doc.destroy?.().catch(() => {});
  }
}

export { LARGE_FILE_THRESHOLD_BYTES };
