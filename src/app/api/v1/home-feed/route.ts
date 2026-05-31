/**
 * `GET /api/v1/home-feed?limit=&cursor=` — the unified home feed.
 *
 * Merges /activities (`rated` + `reviewed` only — `added`/`watched`
 * stay out as low-signal logging) with /posts, chronologically.
 * Cursor is an ISO timestamp; block-filters server-side using the
 * viewer's BlockSet.
 *
 * Public — anonymous viewers see the unfiltered feed. The viewer
 * branch is the auth-aware path that applies the block filter.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getHomeFeed } from '@/lib/posts-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req, { auth }) => {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;
  return getHomeFeed(auth?.uid ?? null, {
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
  });
});

export const OPTIONS = optionsHandler;
