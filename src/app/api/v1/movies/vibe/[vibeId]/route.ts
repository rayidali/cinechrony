/**
 * `GET /api/v1/movies/vibe/[vibeId]` — "browse by vibe" keyword discovery.
 * Public. `vibeId` must be one of the curated ids in `src/lib/vibes.ts`;
 * unknown ids resolve to an empty set (not an error).
 */

import { publicApiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { discoverByVibe } from '@/lib/tmdb-server';

export const dynamic = 'force-dynamic';

type RouteParams = { vibeId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  const vibeId = (params.vibeId || '').trim();
  if (!vibeId) throw new BadRequestError('vibeId is required.');
  return discoverByVibe(vibeId);
});

export const OPTIONS = optionsHandler;
