/**
 * `GET /api/v1/friends-watching` — aggregated "your circle is watching"
 * cards for the home feed. Auth-required (the result is gated on the
 * viewer's "following" set).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getFriendsWatching } from '@/lib/friends-watching-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getFriendsWatching(auth.uid);
});

export const OPTIONS = optionsHandler;
