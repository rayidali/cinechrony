/**
 * `GET /api/v1/watches/recent` — the caller's recently-watched DISTINCT films,
 * newest first. Backs the "recently watched" rail in the post composer's film
 * picker. Owner-scoped; soft-falls-back to an empty list.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getRecentWatches } from '@/lib/watches-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req, { auth }) => {
  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 12;
  return getRecentWatches(auth.uid, limit);
}, { softFallback: { films: [] } });

export const OPTIONS = optionsHandler;
