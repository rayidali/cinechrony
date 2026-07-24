/**
 * `GET /api/v1/movie-nights/upcoming` — the caller's upcoming (or just-passed,
 * awaiting an outcome) proposed movie nights, host or invitee, soonest first.
 * Feeds the home card + coach mark. Soft-degrades to `[]` on a transient
 * Firestore blip (non-critical read).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getUpcomingMovieNights } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getUpcomingMovieNights(auth.uid);
}, { softFallback: [] });

export const OPTIONS = optionsHandler;
