/**
 * `GET /api/v1/leaderboard?window=week|month|all` — the weekly "top watchers"
 * home rail. Auth-required (ranked over the caller's follow graph). See
 * `src/lib/leaderboard-server.ts`.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getWeeklyLeaderboard } from '@/lib/leaderboard-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req, { auth }) => {
  const window = new URL(req.url).searchParams.get('window') ?? 'week';
  const days = window === 'all' ? 3650 : window === 'month' ? 30 : 7;
  return getWeeklyLeaderboard(auth.uid, days);
});

export const OPTIONS = optionsHandler;
