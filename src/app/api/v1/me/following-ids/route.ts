/**
 * `GET /api/v1/me/following-ids` — the caller's FULL follow set as a plain uid
 * array (cap 2000), for client-side scoping like the home "friends" filter.
 *
 * The old path (`/users/[uid]/following`) hydrates up to 50 full profiles and
 * the client threw everything away except the uid — so a user following >50
 * people silently never saw follows #51+ in the friends tab. This uses
 * `getFollowingIds` (one cached read, no profile hydration, MAX_ID_LIMIT=2000),
 * which recognizes the whole graph.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getFollowingIds } from '@/lib/follows-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  const ids = await getFollowingIds(auth.uid, 2000);
  return { ids };
}, { softFallback: { ids: [] } });

export const OPTIONS = optionsHandler;
