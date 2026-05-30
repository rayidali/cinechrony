/**
 * `POST /api/v1/lists/[ownerId]/[listId]/leave` — the verified caller
 * removes themselves from this list's collaborator set.
 *
 * Owners cannot leave their own list (must transfer ownership first or
 * delete the list). Non-collaborators get a 403.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from '@/lib/api-handler';
import {
  leaveList,
  ListNotFoundError,
  NotCollaboratorError,
  OwnerCannotLeaveError,
} from '@/lib/collaborators-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await leaveList(auth.uid, params.ownerId, params.listId);
    revalidatePath('/lists');
    return { success: true };
  } catch (err) {
    if (err instanceof OwnerCannotLeaveError) throw new BadRequestError(err.message);
    if (err instanceof NotCollaboratorError) throw new ForbiddenError(err.message);
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
