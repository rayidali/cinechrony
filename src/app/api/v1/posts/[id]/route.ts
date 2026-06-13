/**
 * `/api/v1/posts/[id]` — GET (block-aware) + PATCH + DELETE.
 *
 *  GET    → `{ post: Post | null }`. Returns null if the viewer is
 *         blocked by/blocks the author (LAUNCH 0.5.5). Anonymous viewers
 *         always see the post. Uses publicApiRoute — auth is optional.
 *
 *  PATCH  body: `{ text?, media?, taggedMovie?, rating?, taggedUserIds?,
 *               place? }` — owner-only edit.
 *
 *  DELETE → owner-only hard delete.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  publicApiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  getPost,
  updatePost,
  deletePost,
  PostNotFoundError,
  PostAuthorMismatchError,
  PostValidationError,
  type CreatePostInput,
} from '@/lib/posts-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

// ─── GET ─────────────────────────────────────────────────────────────────

export const GET = publicApiRoute<RouteParams>(async (_req, { auth, params }) => {
  const post = await getPost(params.id, auth?.uid ?? null);
  return { post };
});

// ─── PATCH ───────────────────────────────────────────────────────────────

export const PATCH = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: CreatePostInput;
  try {
    body = (await req.json()) as CreatePostInput;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    await updatePost(auth.uid, params.id, body);
    revalidatePath(`/post/${params.id}`);
    return { success: true };
  } catch (err) {
    if (err instanceof PostValidationError) throw new BadRequestError(err.message);
    if (err instanceof PostAuthorMismatchError) throw new ForbiddenError(err.message);
    if (err instanceof PostNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await deletePost(auth.uid, params.id);
    revalidatePath('/home');
    return { success: true };
  } catch (err) {
    if (err instanceof PostAuthorMismatchError) throw new ForbiddenError(err.message);
    if (err instanceof PostNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
