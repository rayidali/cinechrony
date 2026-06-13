/**
 * `GET /api/v1/lists/[ownerId]/[listId]/preview` — poster grid + count
 * for a list card. **AUDIT.md 1.13 — privacy gated**: public lists are
 * open; private lists return an empty preview unless the viewer is the
 * owner or a collaborator (token-derived UID, no leak via guessable IDs).
 */

import { publicApiRoute, optionsHandler } from '@/lib/api-handler';
import { getListPreview } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getListPreview(params.ownerId, params.listId, auth?.uid ?? null);
});

export const OPTIONS = optionsHandler;
