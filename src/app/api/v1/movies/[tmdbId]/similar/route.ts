/**
 * `GET /api/v1/movies/[tmdbId]/similar?mediaType=movie|tv&limit=12` —
 * "more like this" via TMDB recommendations (fallback to TMDB similar).
 * Public. Cached on the TMDB side (24h `next: { revalidate }`).
 */

import { publicApiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { getSimilarMovies } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

type RouteParams = { tmdbId: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  const tmdbId = Number(params.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    throw new BadRequestError('tmdbId must be a positive integer.');
  }
  const url = new URL(req.url);
  const mediaTypeParam = url.searchParams.get('mediaType');
  const mediaType: 'movie' | 'tv' = mediaTypeParam === 'tv' ? 'tv' : 'movie';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(50, Number(limitParam))) : 12;
  return getSimilarMovies(tmdbId, mediaType, Number.isFinite(limit) ? limit : 12);
});

export const OPTIONS = optionsHandler;
