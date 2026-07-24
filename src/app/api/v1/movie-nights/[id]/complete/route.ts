/**
 * `POST /api/v1/movie-nights/[id]/complete` — "we watched it": the north-star
 * write. Logs a watch for every attendee (`watchedAt` = the night's
 * `scheduledFor`), applies the caller's own rating/note if given, and
 * nudges the other attendees to rate it too. Idempotent — re-calling an
 * already-completed night just re-applies the caller's rating path.
 *
 *   Body: `{ attendeeUids: string[], rating?: number, note?: string }`
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { completeMovieNight } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const body = await req.json().catch(() => ({}));
  return completeMovieNight(auth.uid, params.id, body);
});

export const OPTIONS = optionsHandler;
