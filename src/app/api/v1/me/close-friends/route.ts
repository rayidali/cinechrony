/**
 * `/api/v1/me/close-friends` — the caller's close-friends inner circle (F04).
 *
 *  GET  → `{ ids: string[] }` — current close-friend uids (server-only store).
 *  PUT  body `{ ids: string[] }` → replaces the list, returns `{ ids }`.
 *
 * The list lives in a server-only `/closeFriends/{uid}` doc so it never leaks
 * through a profile read. Identity comes from the verified Bearer token.
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { getCloseFriendIds, setCloseFriendIds } from '@/lib/follows-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  const ids = await getCloseFriendIds(auth.uid);
  return { ids };
});

export const PUT = apiRoute(async (req, { auth }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new BadRequestError('ids must be an array of strings.');
  }
  return await setCloseFriendIds(auth.uid, ids);
});

export const OPTIONS = optionsHandler;
