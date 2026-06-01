/**
 * `DELETE /api/v1/posts/[id]/comments/[cid]` — delete a post comment.
 *
 * Authorization: comment author OR post author. Post owner has moderation
 * right to drop comments on their own post.
 *
 * Side effect: reply decrements parent's `replyCount`; top-level decrements
 * post's `commentCount`.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  ForbiddenError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  deletePostComment,
  CommentNotFoundError,
  CommentAuthorizationError,
} from '@/lib/post-comments-server';

export const dynamic = 'force-dynamic';

type RouteParams = { id: string; cid: string };

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  try {
    await deletePostComment(auth.uid, params.id, params.cid);
    revalidatePath(`/post/${params.id}`);
    return { success: true };
  } catch (err) {
    if (err instanceof CommentNotFoundError) throw new NotFoundError(err.message);
    if (err instanceof CommentAuthorizationError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
