/**
 * `/api/v1/users/[uid]/mute` — POST (mute) + DELETE (unmute).
 *
 * Mutes are unilateral and silent (vs blocks, which are mutual and visible).
 * The muted user keeps seeing the viewer; the viewer's feed just stops
 * surfacing the muted user's cards.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  muteUser,
  unmuteUser,
  MuteSelfError,
} from '@/lib/mutes-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await muteUser(auth.uid, params.uid);
    return { success: true };
  } catch (err) {
    if (err instanceof MuteSelfError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  await unmuteUser(auth.uid, params.uid);
  return { success: true };
});

export const OPTIONS = optionsHandler;
