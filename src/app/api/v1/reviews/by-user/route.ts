/**
 * `GET /api/v1/reviews/by-user?userId=&tmdbId=` — returns the (at most
 * one) review a given user has authored for a given movie/TV show. Used
 * by the movie modal to surface the viewer's own review at the top.
 *
 * Public read — any user's review on any TMDB id is queryable. The legacy
 * action had the same property.
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { getUserReviewForMovie } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  const tmdbIdRaw = url.searchParams.get('tmdbId');
  const tmdbId = tmdbIdRaw ? Number.parseInt(tmdbIdRaw, 10) : NaN;

  if (!userId) throw new BadRequestError('userId query param is required.');
  if (!Number.isFinite(tmdbId)) {
    throw new BadRequestError('tmdbId query param is required.');
  }

  const review = await getUserReviewForMovie(userId, tmdbId);
  return { review };
});

export const OPTIONS = optionsHandler;
