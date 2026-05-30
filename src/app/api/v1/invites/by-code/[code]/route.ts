/**
 * `GET /api/v1/invites/[code]` — look up an invite by its link code.
 *
 * AUDIT.md 2.9: the legacy `getInviteByCode` had no auth requirement,
 * letting an unauthenticated attacker enumerate codes. This route requires
 * a Bearer token. Combined with CSPRNG codes (54^12 search space), invite
 * enumeration is no longer viable.
 *
 * The `[code]` segment is the user-presented link code, not the Firestore
 * invite document ID.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  getInviteByCode,
  InviteNotFoundError,
  InviteExpiredError,
  InviteValidationError,
} from '@/lib/invites-server';

export const dynamic = 'force-dynamic';

type RouteParams = { code: string };

export const GET = apiRoute<RouteParams>(async (_req, { params }) => {
  try {
    const invite = await getInviteByCode(params.code);
    return { invite };
  } catch (err) {
    if (err instanceof InviteValidationError) throw new BadRequestError(err.message);
    if (err instanceof InviteNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof InviteExpiredError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
