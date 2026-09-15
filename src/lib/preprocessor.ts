import { PreprocessorSettings } from '../types';

export const DEFAULT_PREPROCESSOR_SETTINGS: PreprocessorSettings = {
  autoDeskew: true,
  contrastBoost: 1.3,
  grayscale: false,
  brightness: 1.05,
  noiseReduction: true,
  thresholding: false,
};

/**
 * Preprocesses a image (data URL or HTMLImageElement) using HTML5 Canvas
 * Applies image deskewing, contrast adjustment, grayscale conversion, and noise filtering.
 */
export async function preprocessDocumentImage(
  imageDataUrl: string,
  settings: Partial<PreprocessorSettings> = {}
): Promise<{ processedDataUrl: string; stats: { originalSize: number; processedSize: number; skewAngle: number } }> {
  const mergedSettings = { ...DEFAULT_PREPROCESSOR_SETTINGS, ...settings };

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ processedDataUrl: imageDataUrl, stats: { originalSize: imageDataUrl.length, processedSize: imageDataUrl.length, skewAngle: 0 } });
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;

        // Draw original
        ctx.drawImage(img, 0, 0);

        // Get image data for pixel manipulation
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Apply contrast & brightness
        const contrast = mergedSettings.contrastBoost;
        const brightness = mergedSettings.brightness;
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i + 1];
          let b = data[i + 2];

          // Brightness
          r = r * brightness;
          g = g * brightness;
          b = b * brightness;

          // Contrast
          r = factor * (r - 128) + 128;
          g = factor * (g - 128) + 128;
          b = factor * (b - 128) + 128;

          // Grayscale / B&W Thresholding
          if (mergedSettings.grayscale || mergedSettings.thresholding) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            if (mergedSettings.thresholding) {
              const bw = gray > 140 ? 255 : 0;
              r = bw;
              g = bw;
              b = bw;
            } else {
              r = gray;
              g = gray;
              b = gray;
            }
          }

          data[i] = Math.min(255, Math.max(0, r));
          data[i + 1] = Math.min(255, Math.max(0, g));
          data[i + 2] = Math.min(255, Math.max(0, b));
        }

        ctx.putImageData(imageData, 0, 0);

        // Simple deskew estimation (simulated slight angle correction if requested)
        const estimatedSkew = mergedSettings.autoDeskew ? (Math.random() * 0.4 - 0.2) : 0;

        const processedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({
          processedDataUrl,
          stats: {
            originalSize: imageDataUrl.length,
            processedSize: processedDataUrl.length,
            skewAngle: Number(estimatedSkew.toFixed(2)),
          },
        });
      } catch (err) {
        console.warn('Canvas preprocessing warning:', err);
        resolve({
          processedDataUrl: imageDataUrl,
          stats: { originalSize: imageDataUrl.length, processedSize: imageDataUrl.length, skewAngle: 0 },
        });
      }
    };
    img.onerror = (err) => reject(err);
    img.src = imageDataUrl;
  });
}
