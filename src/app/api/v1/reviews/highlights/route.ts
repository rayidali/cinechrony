/**
 * `GET /api/v1/reviews/highlights` — "hot takes" for the home reel (the green
 * quote card, 0.7.5.4). Auth-required (filters the caller's own takes + block
 * set). Real data only; an empty result hides the card. Soft-falls-back to an
 * empty list so a Firestore blip never 500s the home feed. See
 * `getReviewHighlights` in `src/lib/reviews-server.ts`.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getReviewHighlights } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (_req, { auth }) => {
    const highlights = await getReviewHighlights(auth.uid);
    return { highlights };
  },
  { softFallback: { highlights: [] } },
);

export const OPTIONS = optionsHandler;
