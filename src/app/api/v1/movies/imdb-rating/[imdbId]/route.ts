/**
 * `GET /api/v1/movies/imdb-rating/[imdbId]` — OMDB lookup by IMDB id.
 *
 * Public. The OMDB key is server-only, so this route is the only place
 * client code can read IMDB ratings.
 */

import {
  publicApiRoute,
  optionsHandler,
  clientIp,
  BadRequestError,
  NotFoundError,
  RateLimitedError,
} from '@/lib/api-handler';
import { checkIpRateLimit } from '@/lib/rate-limit';
import {
  getImdbRating,
  ImdbConfigError,
  ImdbNotFoundError,
} from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

type RouteParams = { imdbId: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  // Public OMDB proxy — a loop here drains the shared ~1000/day OMDB quota
  // (the underlying lookup is now 24h-cached, but the cap stops cold-key floods).
  if (!checkIpRateLimit(clientIp(req), 'tmdbProxy', { limit: 60, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  const id = params.imdbId;
  if (!id || !/^tt\d+$/.test(id)) {
    throw new BadRequestError('imdbId must look like "tt1234567".');
  }
  try {
    return await getImdbRating(id);
  } catch (err) {
    if (err instanceof ImdbConfigError) {
      // Surface as 503-ish — but keep the typed-error mapping simple.
      throw new BadRequestError(err.message);
    }
    if (err instanceof ImdbNotFoundError) {
      throw new NotFoundError(err.message);
    }
    throw err;
  }
});

export const OPTIONS = optionsHandler;
