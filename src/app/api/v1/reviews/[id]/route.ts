/**
 * `/api/v1/reviews/[id]` — PATCH (update) + DELETE.
 *
 *  PATCH  body: `{ text?, hasSpoiler? }` — owner-only real edit
 *         (AUDIT.md 2.6 — mutates the original doc, no duplicate post).
 *
 *  DELETE → owner-only hard delete.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  updateReview,
  deleteReview,
  ReviewNotFoundError,
  ReviewAuthorMismatchError,
  ReviewValidationError,
} from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

// ─── PATCH ────────────────────────────────────────────────────────────────

type PatchBody = { text?: string; hasSpoiler?: boolean };

export const PATCH = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    await updateReview(auth.uid, params.id, body);
    revalidatePath('/notifications'); // mention/reply text might be stale
    return { success: true };
  } catch (err) {
    if (err instanceof ReviewValidationError) throw new BadRequestError(err.message);
    if (err instanceof ReviewAuthorMismatchError) throw new ForbiddenError(err.message);
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await deleteReview(auth.uid, params.id);
    return { success: true };
  } catch (err) {
    if (err instanceof ReviewAuthorMismatchError) throw new ForbiddenError(err.message);
    if (err instanceof ReviewNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
