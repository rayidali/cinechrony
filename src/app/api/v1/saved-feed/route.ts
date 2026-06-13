/**
 * `GET /api/v1/saved-feed?cursor=&limit=` — hydrated saved archive.
 *
 * Cursor-paginated FeedItem[] reading the viewer's bookmarks newest-saved
 * first and batch-loading the source activity/post docs. Dangling
 * bookmarks (source deleted) are silently skipped.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getSavedFeed } from '@/lib/bookmarks-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req, { auth }) => {
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  return getSavedFeed(auth.uid, {
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
});

export const OPTIONS = optionsHandler;
