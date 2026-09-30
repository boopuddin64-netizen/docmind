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

// Error classification, the response reader and the timeout-guarded request live in scanErrors.ts (re-exported for callers).
export { ScanError, readScanResponse, requestScan, classifyScanFailure } from './scanErrors';
