/**
 * `/api/v1/reviews/[id]/react` — POST (set/replace) + DELETE (remove) the
 * caller's icon reaction (F14). One reaction per user per review.
 *
 *  POST body: `{ type: 'heart'|'flame'|'droplet'|'grin'|'sparkle' }`
 *  → `{ counts, myReaction }`. Rate-limited (the `like` bucket).
 *  DELETE → `{ counts, myReaction: null }`.
 *
 * Transactional (mutates only the caller's key in the `reactions` map), so
 * concurrent reactors never clobber each other.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  reactReview,
  unreactReview,
  ReviewNotFoundError,
  ReviewValidationError,
} from '@/lib/reviews-server';
import { isReactionType } from '@/lib/review-reactions';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'like');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: { type?: unknown };
  try {
    body = (await req.json()) as { type?: unknown };
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!isReactionType(body.type)) {
    throw new BadRequestError('type must be one of heart|flame|droplet|grin|sparkle.');
  }

  try {
    const { counts, myReaction } = await reactReview(auth.uid, params.id, body.type);
    return { success: true, counts, myReaction };
  } catch (err) {
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof ReviewValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { counts, myReaction } = await unreactReview(auth.uid, params.id);
    return { success: true, counts, myReaction };
  } catch (err) {
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
