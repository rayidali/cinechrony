/**
 * `GET /api/v1/activities?limit=&cursor=` — global activity feed.
 *
 * Cursor is a doc id (matches the getActivityFeed pattern). Public —
 * the activity feed is everyone's reads. Block-filtering is currently
 * client-side via `UserBlocksCacheProvider`; full server-side block
 * filtering will arrive with PR #12 (safety) when blocks land in the
 * route layer.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getActivityFeed } from '@/lib/activities-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;
  return getActivityFeed({
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
  });
});

export const OPTIONS = optionsHandler;
