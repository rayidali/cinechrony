/**
 * `POST /api/v1/lists` — create a list under the verified caller (Phase A PR #3).
 *
 * Body: `{ name, isPublic?, description?, coverMode?, coverImageUrl?,
 *          collaboratorInvites?: [{ uid, username? }] }`
 *
 * Returns: `{ listId }`. The list is created at
 * `users/{verified-uid}/lists/{listId}` — no ownerId in the body.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { createList, ListValidationError, getUserLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/lists` — the caller's own lists (id/name/movieCount/etc.),
 * newest first. Added for the iOS Share Extension's destination picker
 * (`PHASE-C-SHARE-EXTENSION.md` Corner-style in-place drawer) — the extension
 * has no Firestore SDK, so it can't use the web client's real-time
 * `users/{uid}/lists` listener. Same data `getUserLists` already serves
 * publicly at `GET /api/v1/users/[uid]/lists`; this is the Bearer-authed
 * "my lists" shorthand for the signed-in caller.
 */
export const GET = apiRoute(async (_req, { auth }) => {
  return getUserLists(auth.uid);
});

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

export const OPTIONS = optionsHandler;
