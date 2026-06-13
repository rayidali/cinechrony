/**
 * `GET /api/v1/movies/trending` — TMDB trending/day enriched with IMDB.
 *
 * Public (movie data isn't user-scoped). Server-side proxy because the
 * enrichment step calls OMDB with a server-only key.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getTrendingMovies } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async () => {
  return getTrendingMovies();
});

export const OPTIONS = optionsHandler;
