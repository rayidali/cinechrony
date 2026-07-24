/**
 * `GET /api/v1/movie-nights/shared/[code]` — the public, no-auth view of a
 * movie night by its share code (MOVIE-NIGHT-PLAN.md § guest participation,
 * S2). Backs the `/n/[code]` web page (S5). Never a Bearer token; per-IP
 * rate-limited since anyone with the link (or a guesser) can hit it.
 */

import { publicApiRoute, optionsHandler, clientIp, RateLimitedError } from '@/lib/api-handler';
import { getMovieNightByCode } from '@/lib/movie-nights-server';
import { checkIpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { code: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  if (!checkIpRateLimit(clientIp(req), 'movieNightSharedRead', { limit: 30, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  return getMovieNightByCode(params.code);
});

export const OPTIONS = optionsHandler;
