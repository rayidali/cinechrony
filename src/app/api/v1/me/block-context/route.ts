/**
 * `GET /api/v1/me/block-context` — `{ blockedIds, iBlocked }`.
 *
 *   - `blockedIds`: full invisibility union (i-blocked ∪ they-blocked-me).
 *     Feed/search/member-list filters check against this set.
 *   - `iBlocked`: just outgoing blocks — drives the settings unblock list.
 *
 * Both come from `/blocks` collection (server-only — clients can't read
 * the collection directly).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getMyBlockContext } from '@/lib/blocks-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getMyBlockContext(auth.uid);
}, { softFallback: { blockedIds: [], iBlocked: [] } });

export const OPTIONS = optionsHandler;
