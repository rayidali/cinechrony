/**
 * `GET /api/v1/movies/imdb-rating/[imdbId]` — OMDB lookup by IMDB id.
 *
 * Public. The OMDB key is server-only, so this route is the only place
 * client code can read IMDB ratings.
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  getImdbRating,
  ImdbConfigError,
  ImdbNotFoundError,
} from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

type RouteParams = { imdbId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
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
