/**
 * Avatar image compression — decode → downscale → re-encode as JPEG.
 *
 * Shared by the AvatarPicker and the v3 EditProfileSheet. We deliberately use
 * <img> + canvas (not `createImageBitmap`) so HEIC inputs that fail to decode
 * throw cleanly instead of silently uploading an unrenderable `.heic`.
 *
 * Output: 512px square-capped JPEG at q=0.85 → typically 50–150KB even from a
 * 12MP source, well under the server's 5MB ceiling.
 */
export async function compressAvatar(
  file: File,
): Promise<{ base64: string; mimeType: string; fileName: string }> {
  const MAX_EDGE = 512; // an avatar is displayed at <=128px — 512 is plenty
  const QUALITY = 0.85;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error("Couldn't read this image — please pick another."));
      el.src = objectUrl;
    });

    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_EDGE / longest);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Couldn't prepare image — please try again.");
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error("Couldn't process this image — please pick another.");

    const fileName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { base64, mimeType: 'image/jpeg', fileName };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
