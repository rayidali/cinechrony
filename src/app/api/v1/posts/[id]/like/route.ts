/**
 * `/api/v1/posts/[id]/like` — POST (like) + DELETE (unlike).
 *
 * Both transactional (AUDIT.md 3.5 — fourth and final like-surface
 * after reviews, lists, activities). POST rate-limited via the shared
 * `like` bucket (AUDIT.md 3.8). Returns updated like count.
 */

import {
  apiRoute,
  optionsHandler,
  ConflictError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  likePost,
  unlikePost,
  PostNotFoundError,
  PostAlreadyLikedError,
  PostNotLikedError,
} from '@/lib/posts-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'like');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const { likes } = await likePost(auth.uid, params.id);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof PostNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof PostAlreadyLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { likes } = await unlikePost(auth.uid, params.id);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof PostNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof PostNotLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
