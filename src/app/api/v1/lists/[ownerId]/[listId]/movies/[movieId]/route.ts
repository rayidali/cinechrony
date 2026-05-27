/**
 * `/api/v1/lists/[ownerId]/[listId]/movies/[movieId]` — PATCH + DELETE.
 *
 *  PATCH  `{ status?, note?, socialLink? }` — partial update. Collapses
 *         the legacy `updateMovieStatus` + `updateMovieNote` actions plus
 *         the client-side `updateDocumentNonBlocking({ socialLink })` writes
 *         into one editor-gated endpoint. Closes LAUNCH.md A.3.10 + A.3.11
 *         + A.3.12.
 *
 *  DELETE → editor-gated remove. AUDIT.md 2.2: only decrements movieCount
 *         when the movie actually existed (ghost remove = no-op, no drift).
 *         Closes LAUNCH.md A.3.9.
 *
 * Both routes require `canEditList(caller, ownerId, listId)`. Note writes
 * use the VERIFIED uid as the key (AUDIT.md 1.6) — a collaborator cannot
 * author or clear another member's note.
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
  removeMovieFromList,
  updateMovie,
  ListAccessDeniedError,
  MovieNotFoundError,
  MovieValidationError,
  type UpdateMovieFields,
} from '@/lib/movies-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string; movieId: string };

// ─── PATCH ────────────────────────────────────────────────────────────────

type PatchMovieBody = UpdateMovieFields;

export const PATCH = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: PatchMovieBody;
  try {
    body = (await req.json()) as PatchMovieBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    const { wroteWatchedActivity } = await updateMovie(
      auth.uid,
      params.ownerId,
      params.listId,
      params.movieId,
      body,
    );
    revalidatePath(`/lists/${params.listId}`);
    return { success: true, wroteWatchedActivity };
  } catch (err) {
    if (err instanceof MovieValidationError) throw new BadRequestError(err.message);
    if (err instanceof ListAccessDeniedError) throw new ForbiddenError(err.message);
    if (err instanceof MovieNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    const { removed } = await removeMovieFromList(
      auth.uid,
      params.ownerId,
      params.listId,
      params.movieId,
    );
    revalidatePath(`/lists/${params.listId}`);
    return { success: true, removed };
  } catch (err) {
    if (err instanceof ListAccessDeniedError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
