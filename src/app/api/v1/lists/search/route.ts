/**
 * `GET /api/v1/lists/search?q=&limit=` — public-list search (LAUNCH 0.5.3).
 * Public. Substring match over the public-list collection group, ranked by
 * likes. 2-character minimum.
 */

import { publicApiRoute, optionsHandler, clientIp, RateLimitedError } from '@/lib/api-handler';
import { checkIpRateLimit } from '@/lib/rate-limit';
import { searchPublicLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

export const GET = publicApiRoute(async (req) => {
  // ~150-doc collection-group scan + per-match hydration, public + unauthed →
  // the cheapest quota-drain endpoint in the app. Generous per-IP cap.
  if (!checkIpRateLimit(clientIp(req), 'search', { limit: 100, windowMs: 60_000 })) {
    throw new RateLimitedError();
  }
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? '12');
  return searchPublicLists(q, Number.isFinite(limit) ? limit : 12);
});

export const OPTIONS = optionsHandler;
