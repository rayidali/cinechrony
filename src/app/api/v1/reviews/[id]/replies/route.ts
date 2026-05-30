/**
 * `GET /api/v1/reviews/[id]/replies` — paginated replies to a top-level
 * review. Chronological (oldest first). Closes AUDIT.md 3.10 for the
 * replies read path.
 *
 * Query: `limit` (1–100, default 50), `cursor` (last reply doc id).
 * Returns: `{ replies, hasMore, nextCursor? }`. Public.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getReviewReplies } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;
  return getReviewReplies(params.id, {
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
  });
});

export const OPTIONS = optionsHandler;
