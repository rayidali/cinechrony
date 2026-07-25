/**
 * `GET /api/v1/movie-nights/shared/[code]/calendar.ics` — the guest's
 * reminder channel (MOVIE-NIGHT-PLAN.md § guest participation, S2): no
 * account needed, just an `.ics` download. Also used by the in-app
 * "add to calendar" option for uid-based invitees. Returns a raw
 * `text/calendar` `Response` — `publicApiRoute` passes a `Response` return
 * through untouched (see `api-handler.ts`), so envelope wrapping is skipped.
 */

import { publicApiRoute, optionsHandler, clientIp, RateLimitedError } from '@/lib/api-handler';
import { movieNightIcs } from '@/lib/movie-nights-server';
import { checkIpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { code: string };

export const GET = publicApiRoute<RouteParams>(async (req, { params }) => {
  if (!checkIpRateLimit(clientIp(req), 'movieNightSharedRead', { limit: 30, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  const { filename, ics } = await movieNightIcs(params.code);
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
});

export const OPTIONS = optionsHandler;
