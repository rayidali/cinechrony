/**
 * `/api/v1/posts/[id]/comments` — POST + GET.
 *
 *  POST  body: `{ text, parentId? }` — create comment OR reply (1-level).
 *        Rate-limited via the `review` bucket (AUDIT.md 3.8). Block-
 *        checked against the post author.
 *
 *  GET   → `{ comments }`. Block-filtered server-side from the viewer's
 *        perspective. Capped at 300 (1-level threading + small audiences).
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
  createPostComment,
  getPostComments,
  PostNotFoundError,
  BlockedCommentError,
  CommentValidationError,
} from '@/lib/post-comments-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string };

// ─── POST ─────────────────────────────────────────────────────────────────

type CommentBody = { text?: string; parentId?: string | null };

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  const rl = await checkRateLimit(auth.uid, 'review');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: CommentBody;
  try {
    body = (await req.json()) as CommentBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.text !== 'string') {
    throw new BadRequestError('text is required.');
  }

  try {
    const { commentId } = await createPostComment(
      auth.uid,
      params.id,
      body.text,
      typeof body.parentId === 'string' ? body.parentId : null,
    );
    revalidatePath(`/post/${params.id}`);
    return { success: true, commentId };
  } catch (err) {
    if (err instanceof CommentValidationError) throw new BadRequestError(err.message);
    if (err instanceof PostNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof BlockedCommentError) throw new ForbiddenError(err.message);
    throw err;
  }
});

// ─── GET ─────────────────────────────────────────────────────────────────

export const GET = publicApiRoute<RouteParams>(async (_req, { auth, params }) => {
  return getPostComments(params.id, auth?.uid ?? null);
});

export const OPTIONS = optionsHandler;
