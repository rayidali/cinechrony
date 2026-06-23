/**
 * `GET /api/v1/movies/[tmdbId]/list-membership?mediaType=movie|tv` — the
 * caller's own lists, each flagged with whether it already contains this film.
 * Powers the add-to-list membership sheet (F05). Auth-required (own lists only).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { getListsForMovie } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { tmdbId: string };

export const GET = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const tmdbId = Number(params.tmdbId);
  if (!tmdbId || Number.isNaN(tmdbId)) throw new BadRequestError('tmdbId is required.');
  const mediaType = new URL(req.url).searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';
  return getListsForMovie(auth.uid, `${mediaType}_${tmdbId}`);
}, { softFallback: { lists: [] } });

export const OPTIONS = optionsHandler;
