/**
 * `GET /api/v1/users/[uid]/lists` — all of `[uid]`'s owned lists.
 * Public. Reads `/users/[uid]/lists/*` — privacy of individual movies is
 * gated by the per-list endpoints.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getUserLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  return getUserLists(params.uid);
});

export const OPTIONS = optionsHandler;
