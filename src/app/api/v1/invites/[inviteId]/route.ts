/**
 * `DELETE /api/v1/invites/[inviteId]` — revoke a pending invite.
 *
 * AUDIT.md 1.12: owner-OR-inviter can revoke. The status re-check + write
 * happen inside a Firestore transaction (closes the accept↔revoke race).
 *
 * Note: this URL segment `[inviteId]` is the Firestore document ID, NOT the
 * user-facing invite code. Look up by code via `GET /api/v1/invites/[code]`.
 */

import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@/lib/api-handler';
import {
  revokeInvite,
  InviteNotFoundError,
  InviteNotPendingError,
  NotInviteAuthorizedError,
} from '@/lib/invites-server';

export const dynamic = 'force-dynamic';

type RouteParams = { inviteId: string };

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await revokeInvite(auth.uid, params.inviteId);
    return { success: true };
  } catch (err) {
    if (err instanceof InviteNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof InviteNotPendingError) throw new ConflictError(err.message);
    if (err instanceof NotInviteAuthorizedError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
