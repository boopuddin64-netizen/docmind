/**
 * Browser side of /api/scan-document: image downscaling + a response reader that never throws a raw parse error
 * and never invents a result.
 */

export const MAX_UPLOAD_DIMENSION = 1600;
export const JPEG_QUALITY = 0.8;

/** Longest side capped at `max`, aspect ratio kept, never upscaled. */
export function fitWithin(width: number, height: number, max = MAX_UPLOAD_DIMENSION): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decodes an image data URL and re-encodes it as a JPEG no larger than ~1600px. Rejects when the image can not be decoded. */
export function downscaleImage(dataUrl: string, max = MAX_UPLOAD_DIMENSION, quality = JPEG_QUALITY): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, max);
        if (!width || !height) return reject(new Error('empty image'));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        ctx.fillStyle = '#ffffff'; // JPEG has no alpha: flatten transparent PNGs onto white
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('The image could not be decoded'));
    img.src = dataUrl;
  });
}

export class ScanError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ScanError';
  }
}

const FRIENDLY_BY_STATUS: Record<number, string> = {
  400: 'We could not read that file. Please try a clear photo of the document.',
  413: 'That image is too large to upload. Try a smaller photo or crop it.',
  429: 'Too many scans in a short time. Please wait a few minutes and try again.',
  503: 'Document scanning is not available right now.',
};

/**
 * Reads a scan response. Returns the extracted data on success; throws ScanError with a user-safe message otherwise
 * (non-2xx, non-JSON body such as a Vercel HTML/plain-text 413, malformed JSON, or an unsuccessful payload).
 */
export async function readScanResponse(response: Pick<Response, 'ok' | 'status' | 'headers' | 'json'>): Promise<any> {
  const type = response.headers.get('content-type') || '';
  const isJson = /\bjson\b/i.test(type);
  if (!response.ok) {
    let serverMsg = '';
    if (isJson) {
      try { serverMsg = String((await response.json())?.error || ''); } catch { /* ignore */ }
    }
    const msg = response.status === 413 || response.status === 429 || !serverMsg
      ? FRIENDLY_BY_STATUS[response.status] || 'We could not scan this document. Please try again.'
      : serverMsg;
    throw new ScanError(msg, response.status);
  }
  if (!isJson) throw new ScanError('The server sent an unexpected reply. Please try again.', response.status);
  let body: any;
  try { body = await response.json(); } catch { throw new ScanError('The server sent an unreadable reply. Please try again.', response.status); }
  if (!body || body.success !== true || !body.data || typeof body.data !== 'object') {
    throw new ScanError(typeof body?.error === 'string' && body.error ? body.error : 'The scan did not return any results.', response.status);
  }
  return body.data;
}
