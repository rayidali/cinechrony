/**
 * `GET /api/v1/me/mutes` — caller's muted-user ids. Hydrates the cache.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getMyMutes } from '@/lib/mutes-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getMyMutes(auth.uid);
}, { softFallback: { mutedIds: [] } });

export const OPTIONS = optionsHandler;
