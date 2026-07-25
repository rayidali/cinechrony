/**
 * `GET /api/v1/lists/[ownerId]/[listId]/movie-night` — the soonest
 * `proposed` movie night pinned to this list (the list header's pinned
 * card), or `null`. Same privacy gate as `preview`: public lists are open,
 * private lists require the caller be the owner or a collaborator.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getListMovieNight } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getListMovieNight(auth?.uid ?? null, params.ownerId, params.listId);
}, { softFallback: null });

export const OPTIONS = optionsHandler;
