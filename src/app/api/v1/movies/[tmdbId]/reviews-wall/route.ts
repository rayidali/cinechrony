/**
 * `GET /api/v1/movies/[tmdbId]/reviews-wall` — the whole reviews wall (F12) for
 * one film in a single read: the aggregate summary (friends'-framed score +
 * loved/liked/fine/nope distribution + friends-seen) plus every top-level review
 * with its reply bubbles + the caller's reaction/helpful state.
 *
 * `publicApiRoute` (optional auth): logged-out viewers get the wall without
 * friends-seen / my-state; logged-in viewers get the rich version. NOT cached —
 * an author must see their own just-posted review immediately. Soft-falls-back
 * to an empty wall so a Firestore blip never 500s the page. See
 * `getReviewsWall` in `src/lib/reviews-server.ts`.
 */

import { publicApiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { getReviewsWall } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

type RouteParams = { tmdbId: string };

export const GET = publicApiRoute<RouteParams>(
  async (_req, { auth, params }) => {
    if (!/^\d+$/.test(params.tmdbId)) throw new BadRequestError('Invalid tmdbId.');
    const tmdbId = Number.parseInt(params.tmdbId, 10);
    return getReviewsWall(tmdbId, auth?.uid ?? null);
  },
  {
    softFallback: {
      summary: {
        score: null,
        count: 0,
        ratedCount: 0,
        distribution: { loved: 0, liked: 0, fine: 0, nope: 0 },
        friendsSeen: [],
        friendsSeenCount: 0,
      },
      reviews: [],
      truncated: false,
    },
  },
);

export const OPTIONS = optionsHandler;
