/**
 * `GET /api/v1/movies/trending` — TMDB trending/day enriched with IMDB.
 *
 * Public (movie data isn't user-scoped). Server-side proxy because the
 * enrichment step calls OMDB with a server-only key.
 */

import { publicApiRoute, optionsHandler, clientIp, RateLimitedError } from '@/lib/api-handler';
import { checkIpRateLimit } from '@/lib/rate-limit';
import { getTrendingMovies } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  if (!checkIpRateLimit(clientIp(req), 'tmdbProxy', { limit: 60, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  return getTrendingMovies();
});

export const OPTIONS = optionsHandler;
