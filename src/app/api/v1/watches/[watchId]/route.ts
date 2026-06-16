/**
 * `/api/v1/watches/[watchId]` — edit or remove a single watch-log entry.
 *
 * PATCH  body `{ rating?, note? }` → updates the per-watch rating/note shown in
 *        "your history" (does NOT touch the canonical rating or review).
 * DELETE → removes the watch (undo an accidental log); remaining watches
 *          re-derive their ordinals on the next read.
 *
 * Owner-scoped: the watch lives under the authenticated caller's subcollection,
 * so a caller can only ever edit/delete their own.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  updateWatch,
  deleteWatch,
  WatchValidationError,
  WatchNotFoundError,
} from '@/lib/watches-server';

export const dynamic = 'force-dynamic';

type RouteParams = { watchId: string };

export const PATCH = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: { rating?: number | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  try {
    const { watch } = await updateWatch(auth.uid, params.watchId, {
      rating: body.rating,
      note: body.note,
    });
    return { success: true, watch };
  } catch (err) {
    if (err instanceof WatchValidationError) throw new BadRequestError(err.message);
    if (err instanceof WatchNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await deleteWatch(auth.uid, params.watchId);
    return { success: true };
  } catch (err) {
    if (err instanceof WatchValidationError) throw new BadRequestError(err.message);
    if (err instanceof WatchNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
