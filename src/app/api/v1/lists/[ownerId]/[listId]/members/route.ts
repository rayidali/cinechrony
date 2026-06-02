/**
 * `GET /api/v1/lists/[ownerId]/[listId]/members` — owner + collaborators
 * for a list, with display info. Public (any list-member info is already
 * derivable from the list doc itself, which is public when isPublic).
 * 404 if the list doesn't exist.
 */

import {
  publicApiRoute,
  optionsHandler,
  NotFoundError,
} from '@/lib/api-handler';
import { getListMembers, ListNotFoundError } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  try {
    return await getListMembers(params.ownerId, params.listId);
  } catch (err) {
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
