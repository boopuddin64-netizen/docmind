/**
 * Lazy-loads pdf.js and wires its worker for Vite. This file is only ever reached through a dynamic import(), so pdf.js
 * (several hundred KB) never lands in the main bundle. The "legacy" build is used so older phones / WebViews work.
 */
import type { PdfjsLike } from './pdfClient';

let cached: Promise<PdfjsLike> | null = null;

export function loadPdfjs(): Promise<PdfjsLike> {
  if (!cached) {
    cached = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs as unknown as PdfjsLike;
    })().catch((e) => {
      cached = null; // allow a retry (e.g. after a flaky network while fetching the chunk)
      throw e;
    });
  }
  return cached;
}
