/**
 * `GET /api/v1/lists/[ownerId]/[listId]/movies-view` — full list-and-movies
 * payload for the public-list view page. Returns `{ list, movies, isCollaborator }`.
 *
 * Privacy: public lists are open; private lists allow only the owner or
 * a collaborator (token UID). Otherwise → 403.
 *
 * Named `movies-view` (not just `movies`) because `/lists/[ownerId]/[listId]/movies`
 * already exists as the write surface (POST add, DELETE on `[movieId]`); the
 * GET-everything aggregate lives at its own path to keep the existing
 * endpoint contracts stable.
 */

import {
  publicApiRoute,
  optionsHandler,
  NotFoundError,
  ForbiddenError,
} from '@/lib/api-handler';
import {
  getPublicListMovies,
  ListNotFoundError,
  PrivateListError,
} from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    return await getPublicListMovies(params.ownerId, params.listId, auth?.uid ?? null);
  } catch (err) {
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof PrivateListError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
