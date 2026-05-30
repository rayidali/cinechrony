/**
 * `GET /api/v1/ratings/by-user?userId=&tmdbId=` — single rating lookup.
 *
 * Returns `{ rating: UserRating | null }`. Public — a user's rating on a
 * specific movie is queryable; the legacy `getUserRating` had the same
 * shape.
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { getUserRating } from '@/lib/ratings-server';

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

  const rating = await getUserRating(userId, tmdbId);
  return { rating };
});

export const OPTIONS = optionsHandler;
