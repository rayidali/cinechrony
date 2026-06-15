/**
 * `GET /api/v1/leaderboard?window=week|month|all` — the weekly "top watchers"
 * home rail. Auth-required (ranked over the caller's follow graph). See
 * `src/lib/leaderboard-server.ts`.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getWeeklyLeaderboard } from '@/lib/leaderboard-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req, { auth }) => {
  const params = new URL(req.url).searchParams;
  const window = params.get('window') ?? 'week';
  const days = window === 'all' ? 3650 : window === 'month' ? 30 : 7;
  // `limit` lets the "view all" board (F16) request the full ranking; the home
  // rail omits it and gets the default 12. Capped at 50.
  const limitRaw = Number(params.get('limit') ?? '12');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 12;
  return getWeeklyLeaderboard(auth.uid, days, limit);
}, { softFallback: { entries: [] } });

export const OPTIONS = optionsHandler;
