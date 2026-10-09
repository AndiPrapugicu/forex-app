/**
 * Chart screenshots attached to a question. The browser downsizes them before
 * sending (see `AiAnalysisChat`); this is the server's check that what arrived
 * is an image of a supported type and a forwardable size.
 */

/** A PNG, JPEG or WebP data URL. */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const MAX_IMAGES = 2;
/** About 1.5 MB of image: two stay well under Vercel's 4.5 MB request cap. */
export const MAX_IMAGE_CHARS = 2_000_000;

export function checkImages(raw: unknown): { ok: true; images: string[] } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: 'Images must be a list.' };
  if (raw.length > MAX_IMAGES) return { ok: false, reason: `At most ${MAX_IMAGES} images per question.` };
  for (const img of raw) {
    if (typeof img !== 'string' || !IMAGE_DATA_URL.test(img)) return { ok: false, reason: 'Images must be PNG, JPEG or WebP.' };
    if (img.length > MAX_IMAGE_CHARS) return { ok: false, reason: 'An image is too large; attach a smaller screenshot.' };
  }
  return { ok: true, images: raw as string[] };
}
