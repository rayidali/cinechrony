/**
 * `DELETE /api/v1/bookmarks/[itemType]/[itemId]` — remove a saved item.
 * Idempotent (delete on a non-existent doc is a no-op).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { unsaveItem, BookmarkValidationError } from '@/lib/bookmarks-server';

export const dynamic = 'force-dynamic';

type RouteParams = { itemType: string; itemId: string };

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await unsaveItem(auth.uid, params.itemType, params.itemId);
    return { success: true };
  } catch (err) {
    if (err instanceof BookmarkValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
