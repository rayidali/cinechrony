/**
 * `GET /api/v1/me/boot` — the batched boot payload.
 *
 * On launch the bookmarks, mutes, and block-context caches each fired their own
 * cold serverless call. At 2-3 users every one hits a cold instance
 * (firebase-admin init + verifyIdToken), so that's ~3 sequential cold round
 * trips of "feels slow". This returns all three in ONE call (the three
 * providers coalesce onto it via prefetchCachedAction), so it's one cold start
 * and one token verification instead of three. Each slice is already a cheap,
 * server-cached helper.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getMyBookmarks } from '@/lib/bookmarks-server';
import { getMyMutes } from '@/lib/mutes-server';
import { getMyBlockContext } from '@/lib/blocks-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (_req, { auth }) => {
    const [bookmarks, mutes, blocks] = await Promise.all([
      getMyBookmarks(auth.uid),
      getMyMutes(auth.uid),
      getMyBlockContext(auth.uid),
    ]);
    return { bookmarks, mutes, blocks };
  },
  {
    softFallback: {
      bookmarks: { keys: [] },
      mutes: { mutedIds: [] },
      blocks: { blockedIds: [], iBlocked: [] },
    },
  },
);

export const OPTIONS = optionsHandler;
