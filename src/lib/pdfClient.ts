/**
 * Browser-side PDF reading with pdf.js. The pdfjs module is passed in (see pdfjsLoader.ts, which lazy-loads it and sets
 * up the Vite worker), so this file has no heavy static imports and the helpers can be tested with real PDFs in Node.
 */
import {
  MAX_CLIENT_TEXT_CHARS,
  MAX_PDF_TEXT_PAGES,
  type PageRenderer,
  type RenderOptions,
} from './largeFile';
import { fitWithin } from './scanClient';

/** Minimal structural types for the parts of pdf.js used here. */
export interface PdfTextItem { str?: string; hasEOL?: boolean }
export interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: any): { promise: Promise<void> };
  cleanup?(): void;
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy?(): Promise<void>;
}
export interface PdfjsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): { promise: Promise<PdfDocLike>; destroy?: () => Promise<void> };
}

/** User-facing PDF failure (encrypted, corrupt). */
export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfReadError';
  }
}

export const PDF_PASSWORD_MESSAGE = 'This PDF is password-protected. Please remove the password (or export a copy) and try again.';
export const PDF_CORRUPT_MESSAGE = 'We could not open this PDF. It may be corrupt. Try re-saving or re-exporting it.';

/** Maps a pdf.js failure to a friendly PdfReadError. */
export function toPdfReadError(e: unknown): PdfReadError {
  if (e instanceof PdfReadError) return e;
  const name = (e as any)?.name;
  if (name === 'PasswordException') return new PdfReadError(PDF_PASSWORD_MESSAGE);
  return new PdfReadError(PDF_CORRUPT_MESSAGE);
}

export async function openPdf(pdfjs: PdfjsLike, data: ArrayBuffer | Uint8Array): Promise<PdfDocLike> {
  try {
    // isEvalSupported off: no dynamic Function() (keeps strict CSP possible). Copy: pdf.js transfers the buffer to its worker.
    const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)); // plain Uint8Array copy (never a Node Buffer)
    return await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  } catch (e) {
    throw toPdfReadError(e);
  }
}

/**
 * Extracts text page by page. Stops once `maxChars` were collected (no need to read a 500-page PDF for a 60k cap) or
 * after MAX_PDF_TEXT_PAGES pages. Returns the raw text (the caller normalises / caps it).
 */
export async function extractPdfText(doc: PdfDocLike, maxChars = MAX_CLIENT_TEXT_CHARS): Promise<{ text: string; pagesRead: number; stoppedEarly: boolean }> {
  const limit = Math.min(doc.numPages, MAX_PDF_TEXT_PAGES);
  const out: string[] = [];
  let chars = 0;
  let pagesRead = 0;
  try {
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) line += '\n';
      }
      page.cleanup?.();
      pagesRead = n;
      out.push(line);
      chars += line.length;
      if (chars > maxChars * 1.2) break; // enough (headroom for whitespace removed by normalisation)
    }
  } catch (e) {
    throw toPdfReadError(e);
  }
  return { text: out.join('\n\n'), pagesRead, stoppedEarly: pagesRead < doc.numPages };
}

/** Renderer for scanned pages: page `index` (0-based) → JPEG data URL, longest side ≤ maxDimension, white background. */
export function makePageRenderer(doc: PdfDocLike, createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): PageRenderer {
  return async (index: number, opts: RenderOptions) => {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const { width } = fitWithin(base.width, base.height, opts.maxDimension);
    const scale = base.width > 0 ? width / base.width : 1;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PdfReadError('Your browser could not draw this PDF page. Please try a different browser or export the PDF as images.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    } catch (e) {
      throw toPdfReadError(e);
    }
    const url = canvas.toDataURL('image/jpeg', opts.quality);
    page.cleanup?.();
    canvas.width = 0; // release the bitmap memory right away
    canvas.height = 0;
    return url;
  };
}
