/**
 * `POST /api/v1/lists/[ownerId]/[listId]/invite-link` — generate a
 * shareable invite code for this list.
 *
 * Owner or collaborator only. Returns `{ inviteId, inviteCode, expiresAt }`.
 * Code is CSPRNG-derived from a 54-char confusable-free alphabet (AUDIT 2.9).
 * 7-day TTL from issue.
 */

import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  ConflictError,
} from '@/lib/api-handler';
import {
  createInviteLink,
  NotListMemberError,
  MemberCapReachedError,
} from '@/lib/invites-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  // AUDIT.md 3.8 segment: cap scripted invite-link generation.
  const rl = await checkRateLimit(auth.uid, 'invite');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const { inviteId, inviteCode, expiresAt } = await createInviteLink(
      auth.uid,
      params.ownerId,
      params.listId,
    );
    return { success: true, inviteId, inviteCode, expiresAt };
  } catch (err) {
    if (err instanceof NotListMemberError) throw new ForbiddenError(err.message);
    if (err instanceof MemberCapReachedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
