/**
 * `POST /api/v1/lists/[ownerId]/[listId]/transfer` — hand a list to an
 * existing collaborator (Phase A PR #3). Closes AUDIT.md 1.3 (ownership
 * check) + 2.1 (transactional cascade with staged pattern).
 *
 * Body: `{ newOwnerId }`. The route doesn't read `ownerId` from the URL for
 * the auth check — the verified caller IS the current owner; the staged
 * helper double-checks the stored `ownerId` under an atomic pre-flight
 * transaction. If the URL `ownerId` disagrees with the verified caller, the
 * pre-flight returns NotListOwnerError → 403.
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
  transferOwnership,
  ListNotFoundError,
  NotListOwnerError,
  TransferTargetNotCollaboratorError,
} from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type TransferParams = { ownerId: string; listId: string };
type TransferBody = { newOwnerId?: string };

export const POST = apiRoute<TransferParams>(async (req, { auth, params }) => {
  let body: TransferBody;
  try {
    body = (await req.json()) as TransferBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.newOwnerId !== 'string' || body.newOwnerId.length === 0) {
    throw new BadRequestError('newOwnerId is required.');
  }

  // AUDIT.md 1.3 belt-and-suspenders: the URL ownerId must agree with the
  // verified caller. If a client tries `POST /lists/{victimUid}/{listId}/transfer`
  // with their own valid token, the stored `ownerId` (= victimUid) won't
  // match `auth.uid` in the pre-flight transaction either, but failing here
  // saves a round-trip AND beats the self-transfer guard below (otherwise an
  // attacker passing `{newOwnerId: <own-uid>}` against the victim's URL would
  // get a 400 "you already own this" message that's misleading — they don't).
  if (params.ownerId !== auth.uid) {
    throw new ForbiddenError('Only the list owner can transfer ownership of the list.');
  }
  if (body.newOwnerId === auth.uid) {
    throw new BadRequestError('You already own this list.');
  }

  try {
    const result = await transferOwnership(auth.uid, params.listId, body.newOwnerId);
    revalidatePath('/lists');
    revalidatePath(`/lists/${params.listId}`);
    return { success: true, newOwnerId: result.newOwnerId };
  } catch (err) {
    if (err instanceof NotListOwnerError) throw new ForbiddenError(err.message);
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof TransferTargetNotCollaboratorError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  }
});

export const OPTIONS = optionsHandler;
