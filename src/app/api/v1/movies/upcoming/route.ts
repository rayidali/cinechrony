/**
 * `GET /api/v1/movies/upcoming` — TMDB "coming soon" (future releases, US).
 * Public (not user-scoped). Server proxy filters out already-released films.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getUpcomingMovies } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async () => {
  return getUpcomingMovies();
});

export const OPTIONS = optionsHandler;
