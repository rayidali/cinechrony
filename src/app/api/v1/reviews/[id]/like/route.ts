/**
 * `/api/v1/reviews/[id]/like` — POST (like) + DELETE (unlike).
 *
 * Both wrap the check-then-act inside `db.runTransaction`. Concurrent
 * double-tap collapses to exactly one increment + one `likedBy` entry
 * (AUDIT.md 3.5). POST is rate-limited (AUDIT.md 3.8 — `like` bucket).
 *
 * Returns the updated like count so the client can render without a
 * follow-up read.
 */

import {
  apiRoute,
  optionsHandler,
  ConflictError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  likeReview,
  unlikeReview,
  ReviewNotFoundError,
  AlreadyLikedError,
  NotLikedError,
} from '@/lib/reviews-server';
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
    const { likes } = await likeReview(auth.uid, params.id);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof AlreadyLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { likes } = await unlikeReview(auth.uid, params.id);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof NotLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
