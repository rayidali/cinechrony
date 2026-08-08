/**
 * `GET /api/v1/tonight` — the candidate pool for the home hero's
 * "what should we watch?" (Phase D4).
 *
 * Returns a POOL, not a pick: the hero's `another` button shuffles inside what
 * this returns, so a reshuffle costs nothing. See `tonight-server.ts`.
 *
 * `softFallback` because this is a suggestion. A user with no films, or a
 * failed scan, should get a home screen without a hero — never a broken one.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getTonightPool } from '@/lib/tonight-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (_req, { auth }) => getTonightPool(auth.uid),
  { softFallback: { films: [] } },
);

export const OPTIONS = optionsHandler;
