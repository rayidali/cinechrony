/**
 * `/api/v1/lists/[ownerId]/[listId]/like` — POST (like) + DELETE (unlike).
 *
 * Only PUBLIC lists are likeable. Members (owner + collaborators) cannot
 * like their own list — keeps the loved-lists showcase from being gamed
 * by the team. The like-counter check + write is transactional
 * (AUDIT.md 3.5 pattern). Rate-limited via the shared `like` bucket
 * (AUDIT.md 3.8).
 *
 * Side effects: best-effort `list_like` notification to the owner.
 */

import {
  apiRoute,
  optionsHandler,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  likeList,
  unlikeList,
  ListNotFoundError,
  ListNotPublicError,
  CannotLikeOwnListError,
  ListAlreadyLikedError,
  ListNotLikedError,
} from '@/lib/lists-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'like');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const { likes } = await likeList(auth.uid, params.ownerId, params.listId);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof ListNotPublicError) throw new ForbiddenError(err.message);
    if (err instanceof CannotLikeOwnListError) throw new ForbiddenError(err.message);
    if (err instanceof ListAlreadyLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { likes } = await unlikeList(auth.uid, params.ownerId, params.listId);
    return { success: true, likes };
  } catch (err) {
    if (err instanceof ListNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof ListNotLikedError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
