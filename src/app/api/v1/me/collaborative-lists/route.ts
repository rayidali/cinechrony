/**
 * `GET /api/v1/me/collaborative-lists` — lists the caller is a
 * collaborator on (not owner). Auth-required: identity comes from the
 * Bearer token. Drives the "Shared with me" section.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getCollaborativeLists } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getCollaborativeLists(auth.uid);
});

export const OPTIONS = optionsHandler;
