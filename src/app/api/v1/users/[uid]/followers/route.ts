/**
 * `GET /api/v1/users/[uid]/followers` — list of users following `[uid]`.
 *
 * Follow relationships are public — no auth required. Optional `?limit=`
 * query param, capped at 200 (default 50).
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getFollowers } from '@/lib/follows-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const users = await getFollowers(params.uid, Number.isFinite(limit) ? limit : undefined);
  return { users };
});

export const OPTIONS = optionsHandler;
