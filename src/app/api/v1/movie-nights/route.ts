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

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { createMovieNight } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

// Rate limiting lives INSIDE `createMovieNight` for this one endpoint, not
// here in the wrapper like everywhere else. Reason: the budget has to be
// spent AFTER the `clientKey` idempotency check, otherwise a retry that
// creates nothing (a double-tap, a resend after a dropped response) still
// costs the host a night. See the note at the check itself.
export const POST = apiRoute(async (req, { auth }) => {
  const body = await req.json().catch(() => ({}));
  return createMovieNight(auth.uid, body);
});

export const OPTIONS = optionsHandler;
