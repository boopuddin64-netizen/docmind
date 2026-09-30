/** Small pure form helpers shared by the profile / reminder forms. */

/** Max lengths for free-text reminder fields (used as maxLength on inputs AND to clamp on save). */
export const FIELD_LIMITS = { title: 120, issuer: 120, recipient: 80, subject: 250, note: 300 } as const;

export const clamp = (v: string, max: number) => (v || '').slice(0, max);

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export interface Check { ok: boolean; value?: string; error?: string }

export function validateEmail(input: string): Check {
  const v = (input || '').trim();
  if (!v) return { ok: false, error: 'Enter an email address.' };
  if (v.length > 254 || !EMAIL_RE.test(v)) return { ok: false, error: 'Enter a valid email like name@example.com.' };
  return { ok: true, value: v };
}

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

/** Profile photos must be real raster images (SVG/PDF/text are rejected). */
export function validateAvatarFile(file: { type: string; size: number }): Check {
  if (!/^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|bmp)$/i.test(file.type || '')) {
    return { ok: false, error: 'Please choose an image file (JPG, PNG or WebP).' };
  }
  if (file.size > MAX_AVATAR_BYTES) return { ok: false, error: 'That image is too large. Choose one under 8 MB.' };
  return { ok: true };
}
