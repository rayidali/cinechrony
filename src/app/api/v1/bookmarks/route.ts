/**
 * `/api/v1/bookmarks` — POST (save) + GET (key list for the cache).
 *
 *   POST body: `{ itemType: 'activity' | 'post', itemId: string }`
 *   GET   → `{ keys: string[] }` — doc-id pairs `{type}_{id}`, newest first.
 *
 * Unsave (DELETE) is its own route under `[itemType]/[itemId]` since
 * REST clients reach for path params on resource deletes; see
 * `bookmarks/[itemType]/[itemId]/route.ts`.
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import {
  saveItem,
  getMyBookmarks,
  BookmarkValidationError,
} from '@/lib/bookmarks-server';

export const dynamic = 'force-dynamic';

type Body = { itemType?: unknown; itemId?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.itemType !== 'string' || typeof body.itemId !== 'string') {
    throw new BadRequestError('itemType and itemId must be strings.');
  }
  try {
    await saveItem(auth.uid, body.itemType, body.itemId);
    return { success: true };
  } catch (err) {
    if (err instanceof BookmarkValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const GET = apiRoute(async (_req, { auth }) => {
  return getMyBookmarks(auth.uid);
});

export const OPTIONS = optionsHandler;
