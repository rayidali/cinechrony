/**
 * `GET /api/v1/users/[uid]/following` — list of users that `[uid]` follows.
 *
 * Public — no auth required. Optional `?limit=` query param, capped at
 * 200 (default 50).
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getFollowing } from '@/lib/follows-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const users = await getFollowing(params.uid, Number.isFinite(limit) ? limit : undefined);
  return { users };
}, { softFallback: { users: [] } });

export const OPTIONS = optionsHandler;
