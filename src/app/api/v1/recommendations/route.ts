/**
 * `GET /api/v1/recommendations` — "for you" sets for the home feed.
 *
 * Auth-required (the result is gated on the viewer's rating history).
 * Identity from the Bearer token only — the legacy action took an
 * idToken arg; that contract is gone, replaced by Bearer auth.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getRecommendationsForUser } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getRecommendationsForUser(auth.uid);
}, { softFallback: { sets: [] } });

export const OPTIONS = optionsHandler;
