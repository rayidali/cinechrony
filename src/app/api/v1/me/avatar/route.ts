/**
 * `POST /api/v1/me/avatar` — upload a new profile picture (Phase A PR #2).
 *
 * Replaces the FormData-based `uploadAvatar` Server Action. The body is now
 * JSON: `{ base64, fileName, mimeType }`. The avatar-picker already compresses
 * client-side to ~50–150KB JPEG, so a JSON payload of that size is well under
 * Vercel's 4.5MB body limit.
 *
 * Returns `{ url }` with a cache-busting timestamp query (`?v=<ms>`) so the
 * UI refresh hits the new R2 object instead of the CDN-cached old one.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ApiError,
} from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — same ceiling as the legacy action.

type AvatarBody = { base64: string; fileName: string; mimeType: string };

export const POST = apiRoute<Record<string, never>, { url: string }>(
  async (req, { auth }) => {
    let body: AvatarBody;
    try {
      body = (await req.json()) as AvatarBody;
    } catch {
      throw new BadRequestError('Invalid JSON body.');
    }

    if (typeof body.base64 !== 'string' || body.base64.length === 0) {
      throw new BadRequestError('base64 is required.');
    }
    if (typeof body.mimeType !== 'string' || !body.mimeType.startsWith('image/')) {
      throw new BadRequestError(`Invalid file type: ${body.mimeType}. Image files only.`);
    }
    if (typeof body.fileName !== 'string') {
      throw new BadRequestError('fileName is required.');
    }

    const buffer = Buffer.from(body.base64, 'base64');
    if (buffer.length > MAX_BYTES) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      throw new BadRequestError(`File too large (${sizeMB}MB). Maximum size is 5MB.`);
    }

    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL } = process.env;
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
      console.error('[me/avatar] R2 not configured');
      throw new ApiError('INTERNAL', 'Image upload is not configured. Please contact support.');
    }

    const ext = EXT_BY_MIME[body.mimeType] ?? body.mimeType.split('/')[1] ?? 'jpg';
    // AUDIT.md 1.1 segment — key is `avatars/<verified-uid>/avatar.<ext>`.
    // The verified caller IS the upload target; a malicious client can't write
    // to `avatars/<otherUid>/...` because we never read a uid from the body.
    const fileKey = `avatars/${auth.uid}/avatar.${ext}`;

    const s3 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: fileKey,
          Body: buffer,
          ContentType: body.mimeType,
          CacheControl: 'public, max-age=31536000',
        }),
      );
    } catch (err) {
      console.error('[me/avatar] R2 upload failed:', err);
      throw new ApiError('INTERNAL', 'Failed to upload image. Please try again.');
    }

    return { url: `${R2_PUBLIC_BASE_URL}/${fileKey}?v=${Date.now()}` };
  },
);

export const OPTIONS = optionsHandler;
