/**
 * `POST /api/v1/movie-nights/[id]/rsvp` — any invitee (host included) sets
 * their RSVP answer (`{ answer: 'in' | 'maybe' | 'out' }`). Notifies the
 * host (skipped when the host RSVPs to their own night).
 */

import { apiRoute, optionsHandler, RateLimitedError } from '@/lib/api-handler';
import { rsvpMovieNight } from '@/lib/movie-nights-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'movieNightRsvp');
  if (!rl.ok) throw new RateLimitedError(rl.error);

  const body = (await req.json().catch(() => ({}))) as { answer?: unknown };
  return rsvpMovieNight(auth.uid, params.id, body.answer);
});

export const OPTIONS = optionsHandler;
