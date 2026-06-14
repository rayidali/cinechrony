/**
 * `GET /api/v1/movies/now-playing` — TMDB "in theatres" (region US).
 * Public (not user-scoped). Server proxy keeps the TMDB call + cache one place.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getNowPlayingMovies } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async () => {
  return getNowPlayingMovies();
});

export const OPTIONS = optionsHandler;
