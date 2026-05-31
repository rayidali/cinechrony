/**
 * `POST /api/v1/posts/media-upload-url` — presigned R2 PUT URL.
 *
 * Body: `{ fileName, contentType, fileSize }`. Returns
 * `{ uploadUrl, publicUrl }`. The R2 key is forced under
 * `posts/{verifiedUid}/` — the uid portion is the verified caller, not a
 * client param, so a malicious client cannot write into another user's
 * media prefix.
 *
 * Image OR video, max 200MB. URL expires in 10 minutes.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ConflictError,
} from '@/lib/api-handler';
import {
  getPostMediaUploadUrl,
  MediaUploadValidationError,
  MediaUploadConfigError,
} from '@/lib/posts-server';

export const dynamic = 'force-dynamic';

type Body = {
  fileName?: string;
  contentType?: string;
  fileSize?: number;
};

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  if (typeof body.fileName !== 'string') throw new BadRequestError('fileName is required.');
  if (typeof body.contentType !== 'string') throw new BadRequestError('contentType is required.');
  if (typeof body.fileSize !== 'number') throw new BadRequestError('fileSize is required.');

  try {
    const { uploadUrl, publicUrl } = await getPostMediaUploadUrl(auth.uid, {
      fileName: body.fileName,
      contentType: body.contentType,
      fileSize: body.fileSize,
    });
    return { success: true, uploadUrl, publicUrl };
  } catch (err) {
    if (err instanceof MediaUploadValidationError) throw new BadRequestError(err.message);
    if (err instanceof MediaUploadConfigError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
