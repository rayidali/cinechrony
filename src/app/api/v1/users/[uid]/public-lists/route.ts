/**
 * `GET /api/v1/users/[uid]/public-lists` — only the public lists for
 * `[uid]`, sorted client-style by `updatedAt` desc. Powers the public
 * profile view.
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getUserPublicLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  return getUserPublicLists(params.uid);
});

export const OPTIONS = optionsHandler;
