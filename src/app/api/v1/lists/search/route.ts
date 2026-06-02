/**
 * `GET /api/v1/lists/search?q=&limit=` — public-list search (LAUNCH 0.5.3).
 * Public. Substring match over the public-list collection group, ranked by
 * likes. 2-character minimum.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { searchPublicLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? '12');
  return searchPublicLists(q, Number.isFinite(limit) ? limit : 12);
});

export const OPTIONS = optionsHandler;
