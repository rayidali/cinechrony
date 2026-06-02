/**
 * `GET /api/v1/lists/loved?limit=` — editorial loved-lists showcase.
 * Public. Cold-start gated: returns `{ lists: [], gated: true }` until
 * at least 3 public lists have been liked.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getLovedLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '12');
  return getLovedLists(Number.isFinite(limit) ? limit : 12);
});

export const OPTIONS = optionsHandler;
