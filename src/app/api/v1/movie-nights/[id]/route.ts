/**
 * `GET /api/v1/movie-nights/[id]` — a single movie night. Host/invitee only
 * (403 otherwise, 404 if missing).
 *
 * `PATCH /api/v1/movie-nights/[id]` — lifecycle transitions:
 *   `{ action: 'reschedule', scheduledFor }` — host-only, must be future,
 *     stamps `previousScheduledFor`, resets the reminder/morning-after claims.
 *   `{ action: 'cancel' }` — host-only.
 *   `{ action: 'didnt_happen' }` — any invitee, only once `scheduledFor` has
 *     passed (the morning-after "we didn't watch it" path).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getMovieNight, updateMovieNight } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const GET = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getMovieNight(auth.uid, params.id);
});

export const PATCH = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const body = await req.json().catch(() => ({}));
  return updateMovieNight(auth.uid, params.id, body);
});

export const OPTIONS = optionsHandler;
