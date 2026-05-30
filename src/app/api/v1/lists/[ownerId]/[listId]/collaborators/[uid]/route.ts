/**
 * `DELETE /api/v1/lists/[ownerId]/[listId]/collaborators/[uid]` — owner
 * removes a collaborator from a list.
 *
 * AUDIT.md 1.4: the legacy check was tautological (compared client-supplied
 * `ownerId` against itself). The route now passes the verified caller's uid
 * to the helper, which compares it against the STORED `ownerId`. Only the
 * real owner can kick collaborators.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  removeCollaborator,
  ListNotFoundError,
  NotListOwnerError,
} from '@/lib/collaborators-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string; uid: string };

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await removeCollaborator(auth.uid, params.ownerId, params.listId, params.uid);
    revalidatePath('/lists');
    revalidatePath(`/lists/${params.listId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof NotListOwnerError) throw new ForbiddenError(err.message);
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
