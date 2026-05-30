/**
 * `/api/v1/users/[uid]/follow` — POST follow / DELETE unfollow.
 *
 * The `[uid]` segment is the target user. Caller identity comes from the
 * Bearer token. Rate-limited at the route layer for POST (AUDIT.md 3.8).
 *
 * POST   → 200 on first follow, 409 if already-following, 400 on self-
 *          follow, 403 if blocked in either direction, 404 if target
 *          doesn't exist.
 * DELETE → 200 always (idempotent: ghost unfollow is a no-op, no count
 *          drift). Body `{ unfollowed: boolean }` lets callers tell the
 *          two apart if they care.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  followUser,
  unfollowUser,
  SelfFollowError,
  FollowBlockedError,
  AlreadyFollowingError,
  TargetUserNotFoundError,
} from '@/lib/follows-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { uid: string };

// ─── POST ────────────────────────────────────────────────────────────────

export const POST = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  // AUDIT.md 3.8 (follow segment): cap scripted follow spam.
  const rl = await checkRateLimit(auth.uid, 'follow');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    await followUser(auth.uid, params.uid);
    revalidatePath('/profile');
    revalidatePath(`/profile/${params.uid}`);
    return { success: true };
  } catch (err) {
    if (err instanceof SelfFollowError) throw new BadRequestError(err.message);
    if (err instanceof FollowBlockedError) throw new ForbiddenError(err.message);
    if (err instanceof AlreadyFollowingError) throw new ConflictError(err.message);
    if (err instanceof TargetUserNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────

export const DELETE = apiRoute<RouteParams>(async (_req, { auth, params }) => {
  const { unfollowed } = await unfollowUser(auth.uid, params.uid);
  revalidatePath('/profile');
  revalidatePath(`/profile/${params.uid}`);
  return { success: true, unfollowed };
});

export const OPTIONS = optionsHandler;
