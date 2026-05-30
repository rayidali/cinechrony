/**
 * `POST /api/v1/invites/[inviteId]/decline` — invitee declines a pending
 * invite. Only the invite's intended recipient can decline.
 *
 * Best-effort side-effect: the corresponding `list_invite` notification is
 * deleted so the Accept/Decline buttons disappear from the notifications
 * page (handled inside the helper).
 */

import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  declineInvite,
  InviteNotFoundError,
  NotInviteRecipientError,
} from '@/lib/invites-server';

export const dynamic = 'force-dynamic';

type RouteParams = { inviteId: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await declineInvite(auth.uid, params.inviteId);
    return { success: true };
  } catch (err) {
    if (err instanceof InviteNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof NotInviteRecipientError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
