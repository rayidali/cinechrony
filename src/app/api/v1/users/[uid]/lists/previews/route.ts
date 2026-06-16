/**
 * `POST /api/v1/users/[uid]/lists/previews` — batch preview lookup for a
 * caller-supplied set of list IDs owned by `[uid]`. POST (not GET) so
 * `listIds[]` can be of arbitrary size without URL-length limits. Privacy
 * is enforced PER LIST (the same AUDIT 1.13 check as
 * `/lists/[ownerId]/[listId]/preview`).
 */

import { publicApiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { getListsPreviews } from '@/lib/lists-server';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };
type Body = { listIds?: unknown };

export const POST = publicApiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!Array.isArray(body.listIds) || !body.listIds.every((s) => typeof s === 'string')) {
    throw new BadRequestError('listIds must be an array of strings.');
  }
  return getListsPreviews(params.uid, body.listIds, auth?.uid ?? null);
}, { softFallback: { previews: {} } });

export const OPTIONS = optionsHandler;
