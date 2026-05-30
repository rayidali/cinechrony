/**
 * `DELETE /api/v1/ratings/[tmdbId]` — delete the caller's rating for a
 * movie/TV show. Caller-owns-it is enforced by the deterministic doc id
 * (`${callerUid}_${tmdbId}`) + a belt-and-suspenders field check.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  deleteRating,
  RatingNotFoundError,
  RatingOwnerMismatchError,
} from '@/lib/ratings-server';

export const dynamic = 'force-dynamic';

type RouteParams = { tmdbId: string };

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  const tmdbId = Number.parseInt(params.tmdbId, 10);
  if (!Number.isFinite(tmdbId)) {
    throw new BadRequestError('tmdbId must be numeric.');
  }
  try {
    await deleteRating(auth.uid, tmdbId);
    return { success: true };
  } catch (err) {
    if (err instanceof RatingNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof RatingOwnerMismatchError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
