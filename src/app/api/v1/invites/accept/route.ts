/**
 * `POST /api/v1/invites/accept` — accept an invite by `inviteId` OR
 * `inviteCode`. Body must contain exactly one of:
 *
 *   { inviteId: "..." }    — used from the in-app pending-invites list or
 *                            from a `list_invite` notification
 *   { inviteCode: "..." }  — used from a shared invite link (`/invite/[code]`)
 *
 * AUDIT.md 1.11: the helper runs the status re-check + member-cap check +
 * member-add as a single Firestore transaction. Concurrent accepts collapse
 * to one (Firestore contention retry); a revoke that happens mid-flight is
 * caught by the in-tx status check. Returns `{ listId, listOwnerId }` so the
 * client can navigate to the joined list.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  acceptInvite,
  InviteNotFoundError,
  InviteExpiredError,
  InviteNotPendingError,
  NotInviteRecipientError,
  AlreadyCollaboratorError,
  MemberCapReachedError,
  InviteValidationError,
} from '@/lib/invites-server';

export const dynamic = 'force-dynamic';

type AcceptBody = { inviteId?: string; inviteCode?: string };

export const POST = apiRoute(async (req, { auth }) => {
  let body: AcceptBody;
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!body.inviteId && !body.inviteCode) {
    throw new BadRequestError('inviteId or inviteCode is required.');
  }

  try {
    const { listId, listOwnerId } = await acceptInvite(auth.uid, {
      inviteId: typeof body.inviteId === 'string' ? body.inviteId : undefined,
      inviteCode: typeof body.inviteCode === 'string' ? body.inviteCode : undefined,
    });
    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true, listId, listOwnerId };
  } catch (err) {
    if (err instanceof InviteValidationError) throw new BadRequestError(err.message);
    if (err instanceof InviteNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof InviteExpiredError) throw new NotFoundError(err.message);
    if (err instanceof InviteNotPendingError) throw new ConflictError(err.message);
    if (err instanceof NotInviteRecipientError) throw new ForbiddenError(err.message);
    if (err instanceof AlreadyCollaboratorError) throw new ConflictError(err.message);
    if (err instanceof MemberCapReachedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
