/**
 * `POST /api/v1/movie-nights` — plan a movie night: one film, one datetime,
 * host + up to 9 invitees. Invitees must be a member of the given list OR
 * followed by the host; an ineligible or blocked pick (either direction) is
 * silently dropped rather than failing the request. Rate-limited (10/day —
 * MOVIE-NIGHT-PLAN.md § locked decisions; a rare, deliberate action, unlike
 * a like/follow).
 *
 *   Body: `{ film, scheduledFor, tzOffsetMinutes?, reminderPreset?,
 *            inviteeUids?, listId?, listOwnerId? }`
 *   → `MovieNightView`
 */

import { apiRoute, optionsHandler, RateLimitedError } from '@/lib/api-handler';
import { createMovieNight } from '@/lib/movie-nights-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  const rl = await checkRateLimit(auth.uid, 'movieNightCreate');
  if (!rl.ok) throw new RateLimitedError(rl.error);

  const body = await req.json().catch(() => ({}));
  return createMovieNight(auth.uid, body);
});

export const OPTIONS = optionsHandler;
