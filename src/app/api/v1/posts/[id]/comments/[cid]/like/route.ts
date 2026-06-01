/**
 * `/api/v1/posts/[id]/comments/[cid]/like` — POST (like) + DELETE (unlike).
 *
 * Transactional read-check-write (AUDIT.md 3.5 pattern). POST rate-limited
 * via the shared `like` bucket (AUDIT.md 3.8). Returns updated like count.
 */

import {
  apiRoute,
  optionsHandler,
  ConflictError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  likePostComment,
  unlikePostComment,
  CommentNotFoundError,
  CommentAlreadyLikedError,
  CommentNotLikedError,
} from '@/lib/post-comments-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string; cid: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'like');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const { likes } = await likePostComment(auth.uid, params.id, params.cid);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof CommentNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof CommentAlreadyLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { likes } = await unlikePostComment(auth.uid, params.id, params.cid);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof CommentNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof CommentNotLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
