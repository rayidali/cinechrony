/**
 * `/api/v1/lists/[ownerId]/[listId]/invites` — list-scoped invite ops.
 *
 *  POST   body `{ inviteeId }` → direct in-app invite to a specific user.
 *         Caller must be owner or collaborator. Rate-limited via the route
 *         layer (legacy used `checkRateLimit(uid, 'invite')` — TODO: re-wire
 *         once invite rate-limit key is reachable here).
 *
 *  GET    → list pending invites for this list. Owner sees inviteCode;
 *         collaborator does NOT (AUDIT 1.14).
 *
 * Sibling `POST /invite-link` (separate file) generates a CSPRNG-coded
 * shareable link invite.
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
  inviteToList,
  getListPendingInvites,
  InviteValidationError,
  NotListMemberError,
  AlreadyCollaboratorError,
  AlreadyInvitedError,
  MemberCapReachedError,
  InviteeNotFoundError,
} from '@/lib/invites-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

// ─── POST ────────────────────────────────────────────────────────────────

type InviteBody = { inviteeId?: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  // AUDIT.md 3.8 segment: cap scripted invite spam.
  const rl = await checkRateLimit(auth.uid, 'invite');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.inviteeId !== 'string' || !body.inviteeId) {
    throw new BadRequestError('inviteeId is required.');
  }

  try {
    const { inviteId } = await inviteToList(
      auth.uid,
      params.ownerId,
      params.listId,
      body.inviteeId,
    );
    revalidatePath(`/lists/${params.listId}`);
    return { success: true, inviteId };
  } catch (err) {
    if (err instanceof InviteValidationError) throw new BadRequestError(err.message);
    if (err instanceof NotListMemberError) throw new ForbiddenError(err.message);
    if (err instanceof MemberCapReachedError) throw new ConflictError(err.message);
    if (err instanceof AlreadyCollaboratorError) throw new ConflictError(err.message);
    if (err instanceof AlreadyInvitedError) throw new ConflictError(err.message);
    if (err instanceof InviteeNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── GET ─────────────────────────────────────────────────────────────────

export const GET = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const invites = await getListPendingInvites(auth.uid, params.ownerId, params.listId);
    return { invites };
  } catch (err) {
    if (err instanceof NotListMemberError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
