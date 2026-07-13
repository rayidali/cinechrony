/**
 * `/api/v1/lists` — POST (create) + GET (the caller's own list picker).
 *
 *   POST body: `{ name, isPublic?, description?, coverMode?, coverImageUrl?,
 *                collaboratorInvites?: [{ uid, username? }] }`
 *     Returns: `{ listId }`. The list is created at
 *     `users/{verified-uid}/lists/{listId}` — no ownerId in the body.
 *
 *   GET → `{ lists: ListSummary[] }` — every list the caller owns, private
 *     included, via `getUserLists(auth.uid)` (the SAME helper backing the
 *     public `GET /api/v1/users/[uid]/lists`, which already returns a user's
 *     full list set unfiltered — so this route just scopes it to the
 *     authenticated caller instead of adding a new query shape). Powers a
 *     destination-list picker — e.g. the iOS share extension / `/extract`
 *     save flow. One query, no per-list movies-subcollection reads.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { createList, getUserLists, ListValidationError } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type CreateListBody = {
  name?: string;
  isPublic?: boolean;
  description?: string;
  coverMode?: 'auto' | 'custom';
  coverImageUrl?: string;
  collaboratorInvites?: Array<{ uid?: string; username?: string | null }>;
};

export const POST = apiRoute(async (req, { auth }) => {
  let body: CreateListBody;
  try {
    body = (await req.json()) as CreateListBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.name !== 'string') {
    throw new BadRequestError('name is required.');
  }

  try {
    const { listId } = await createList(auth.uid, body.name, {
      isPublic: body.isPublic,
      description: body.description,
      coverMode: body.coverMode,
      coverImageUrl: body.coverImageUrl,
      collaboratorInvites: body.collaboratorInvites
        ?.filter((i): i is { uid: string; username?: string | null } => typeof i?.uid === 'string')
        .map((i) => ({ uid: i.uid, username: i.username ?? null })),
    });
    revalidatePath('/lists');
    return { success: true, listId };
  } catch (err) {
    if (err instanceof ListValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const GET = apiRoute(async (_req, { auth }) => {
  return getUserLists(auth.uid);
});

export const OPTIONS = optionsHandler;
