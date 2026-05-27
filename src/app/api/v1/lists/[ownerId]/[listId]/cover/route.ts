/**
 * `/api/v1/lists/[ownerId]/[listId]/cover` — Phase A PR #3.
 *
 *   POST   `{ base64, fileName, mimeType }` → uploads the image to R2 and
 *          sets `coverImageUrl` on the list doc in one shot. Returns `{ url }`.
 *   DELETE                                 → clears `coverImageUrl` (sets null).
 *
 * Permission: owner OR collaborator (`canEditList`). Closes AUDIT.md 1.5 —
 * the R2 key is keyed off the list path (`covers/{ownerId}/{listId}/...`),
 * not anything client-supplied; the auth wrapper verified the caller; the
 * `canEditList` helper gates writes. A caller can't overwrite another list's
 * cover.
 *
 * R2 logic is inline (still only two callers across the app — avatar +
 * cover). Will extract to a shared helper in PR #9 when post-media joins.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/firebase/admin';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  ApiError,
} from '@/lib/api-handler';
import { canEditList, setListCover, NotListOwnerError } from '@/lib/lists-server';

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

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — covers can be larger than avatars.

type CoverParams = { ownerId: string; listId: string };
type CoverBody = { base64: string; fileName: string; mimeType: string };

export const POST = apiRoute<CoverParams, { url: string }>(
  async (req, { auth, params }) => {
    let body: CoverBody;
    try {
      body = (await req.json()) as CoverBody;
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

    const allowed = await canEditList(auth.uid, params.ownerId, params.listId);
    if (!allowed) {
      throw new ForbiddenError('You do not have permission to update this list.');
    }

    const buffer = Buffer.from(body.base64, 'base64');
    if (buffer.length > MAX_BYTES) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      throw new BadRequestError(`File too large (${sizeMB}MB). Maximum size is 10MB.`);
    }

    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL } = process.env;
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
      console.error('[lists/cover] R2 not configured');
      throw new ApiError('INTERNAL', 'Image upload is not configured. Please contact support.');
    }

    const ext = EXT_BY_MIME[body.mimeType] ?? body.mimeType.split('/')[1] ?? 'jpg';
    // Path-derived key — `ownerId` from the URL, NOT the body. canEditList
    // already verified the caller is owner or collaborator on that path.
    const fileKey = `covers/${params.ownerId}/${params.listId}/cover.${ext}`;

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
      console.error('[lists/cover] R2 upload failed:', err);
      throw new ApiError('INTERNAL', 'Failed to upload image. Please try again.');
    }

    const url = `${R2_PUBLIC_BASE_URL}/${fileKey}?v=${Date.now()}`;

    // R2 write succeeded — persist the URL on the list doc. If THIS fails we
    // still return the URL so the client can retry the Firestore write later
    // without re-uploading; legacy uploadListCover did the same.
    try {
      const db = getDb();
      await db
        .collection('users').doc(params.ownerId)
        .collection('lists').doc(params.listId)
        .update({ coverImageUrl: url, updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      console.error('[lists/cover] Firestore update failed (URL valid):', err);
      // Don't throw — the upload succeeded, so the caller can use the URL.
      return { url };
    }

    revalidatePath('/lists');
    revalidatePath(`/lists/${params.listId}`);
    return { url };
  },
);

export const DELETE = apiRoute<CoverParams>(async (_req, { auth, params }) => {
  try {
    await setListCover(auth.uid, params.ownerId, params.listId, null);
    revalidatePath('/lists');
    revalidatePath(`/lists/${params.listId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof NotListOwnerError) {
      throw new ForbiddenError('You do not have permission to update this list.');
    }
    throw err;
  }
});

export const OPTIONS = optionsHandler;
