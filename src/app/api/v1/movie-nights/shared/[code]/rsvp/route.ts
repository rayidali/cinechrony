/**
 * `POST /api/v1/movie-nights/shared/[code]/rsvp` — a no-account guest RSVPs
 * via the share link (MOVIE-NIGHT-PLAN.md § guest participation, S2).
 * `{ guestId, name, answer }`. Tighter per-IP bucket than the read route —
 * this is a write, and free-text (the name) makes it the one guest surface
 * worth throttling hardest.
 */

import { publicApiRoute, optionsHandler, clientIp, RateLimitedError } from '@/lib/api-handler';
import { guestRsvpMovieNight } from '@/lib/movie-nights-server';
import { checkIpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { code: string };

export const POST = publicApiRoute<RouteParams>(async (req, { params }) => {
  if (!checkIpRateLimit(clientIp(req), 'movieNightGuestRsvp', { limit: 10, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  const body = (await req.json().catch(() => ({}))) as {
    guestId?: unknown;
    name?: unknown;
    answer?: unknown;
  };
  return guestRsvpMovieNight(params.code, body);
});

export const OPTIONS = optionsHandler;
