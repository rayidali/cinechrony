/**
 * `GET /api/v1/users/[uid]/ratings?limit=&cursor=` — paginated list of a
 * user's ratings. Cursor is the previous page's last `updatedAt` ISO
 * timestamp. Closes AUDIT.md 2.5 (Letterboxd-importer 500-cap regression).
 *
 * Public — any user's ratings are queryable. limit defaults 100, max 500.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getUserRatings } from '@/lib/ratings-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;
  return getUserRatings(params.uid, {
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
  });
});

export const OPTIONS = optionsHandler;
