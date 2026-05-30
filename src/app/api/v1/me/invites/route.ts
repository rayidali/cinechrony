/**
 * `GET /api/v1/me/invites` — pending invites for the verified caller.
 *
 * Replaces the legacy `getMyPendingInvites(userId)` action which took a
 * client-supplied userId — an IDOR vector. Bearer-only here.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getMyPendingInvites } from '@/lib/invites-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  const invites = await getMyPendingInvites(auth.uid);
  return { invites };
});

export const OPTIONS = optionsHandler;
