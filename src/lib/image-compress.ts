/**
 * Client-side image compression for post media.
 *
 * Downscales + re-encodes a photo before it's uploaded to R2 — a 12MP phone
 * photo (~5MB) becomes ~300–600KB, cutting upload time and storage with no
 * visible quality loss in a feed. Robust by design: ANY failure (an
 * undecodable format, a missing canvas context, no size win) falls back to
 * the original file, so it can never break an upload.
 *
 * Video is intentionally NOT handled here — real transcoding belongs on the
 * server (Cloudflare Stream); doing it in-browser (ffmpeg.wasm) is a 25MB+
 * download that OOMs on large files. Videos upload as-is.
 */

const MAX_EDGE = 1920; // longest edge, px
const QUALITY = 0.82; // JPEG quality
const SKIP_BELOW_BYTES = 600 * 1024; // already small enough — don't bother

/**
 * Returns a compressed JPEG `File`, or the original file unchanged if
 * compression isn't applicable or wouldn't help.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof window === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;
  // Animated GIFs would be flattened to a single frame — leave them alone.
  if (file.type === 'image/gif') return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  try {
    // `imageOrientation: 'from-image'` bakes in EXIF rotation so phone photos
    // don't come out sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    // No blob, or compression didn't actually shrink it → keep the original.
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (error) {
    console.warn('[compressImage] falling back to the original file:', error);
    return file;
  }
}
