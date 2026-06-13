/**
 * `/api/v1/users/[uid]/block` — POST (block) + DELETE (unblock).
 *
 * Block is mutual invisibility (LAUNCH.md 0.5.5). On block, follow records
 * are severed in BOTH directions (with count decrements on each user
 * doc) and pending invites between the two are revoked. The follow
 * relationship is NOT restored on unblock — the other party has to
 * re-follow if they still want to.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  blockUser,
  unblockUser,
  BlockSelfError,
} from '@/lib/blocks-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await blockUser(auth.uid, params.uid);
    return { success: true };
  } catch (err) {
    if (err instanceof BlockSelfError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  await unblockUser(auth.uid, params.uid);
  return { success: true };
});

export const OPTIONS = optionsHandler;
