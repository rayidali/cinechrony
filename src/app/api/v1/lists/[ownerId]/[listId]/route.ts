/**
 * `/api/v1/lists/[ownerId]/[listId]` — PATCH + DELETE on a specific list.
 *
 *  PATCH  `{ name?, description?, isPublic? }` → owner-only partial update.
 *         Collapses four legacy actions: renameList, updateListDescription,
 *         updateListVisibility, toggleListVisibility. The client computes
 *         the flip for toggle (just sends the new boolean).
 *
 *  DELETE → owner-only cascade. Closes movies subcollection + revokes any
 *         pending invites. Cannot delete the default list.
 *
 * `[ownerId]` is in the path because the Firestore data model is
 * `users/{ownerId}/lists/{listId}` — the owner key is required for the read.
 * A list ID alone would need a collectionGroup query for every operation;
 * keeping ownerId in the path keeps every read O(1) and the URL
 * self-documenting.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  updateListFields,
  deleteList,
  ListNotFoundError,
  NotListOwnerError,
  CannotDeleteDefaultListError,
  ListValidationError,
} from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type ListRouteParams = { ownerId: string; listId: string };

// ─── PATCH ────────────────────────────────────────────────────────────────

type PatchListBody = {
  name?: string;
  description?: string;
  isPublic?: boolean;
};

export const PATCH = apiRoute<ListRouteParams>(async (req, { auth, params }) => {
  let body: PatchListBody;
  try {
    body = (await req.json()) as PatchListBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    await updateListFields(auth.uid, params.ownerId, params.listId, body);
    revalidatePath('/lists');
    revalidatePath(`/lists/${params.listId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof ListValidationError) throw new BadRequestError(err.message);
    if (err instanceof NotListOwnerError) throw new ForbiddenError(err.message);
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────

export const DELETE = apiRoute<ListRouteParams>(async (_req, { auth, params }) => {
  try {
    await deleteList(auth.uid, params.ownerId, params.listId);
    revalidatePath('/lists');
    return { success: true };
  } catch (err) {
    if (err instanceof NotListOwnerError) throw new ForbiddenError(err.message);
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof CannotDeleteDefaultListError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
