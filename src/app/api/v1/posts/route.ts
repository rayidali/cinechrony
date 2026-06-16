/**
 * `POST /api/v1/posts` — create a user post (LAUNCH 0.5.4).
 *
 * Body: `{ text?, media?, taggedMovie?, rating?, taggedUserIds?, place?,
 *          watchType?, watchedOn?, visibility? }`.
 *
 * Rate-limited via the shared `post` bucket (AUDIT.md 3.8). Side
 * effects: `post_tag` notifications for tagged users + @-mentions in
 * text; optional rating upsert into `/ratings/{uid}_{tmdbId}` when a
 * rating is supplied alongside a tagged film (post = unified
 * review+rating event); a watch-log entry for the tagged film (F04
 * "your watch"); a write-time audience snapshot for restricted posts.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  createPost,
  PostValidationError,
  type CreatePostInput,
} from '@/lib/posts-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  const rl = await checkRateLimit(auth.uid, 'post');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: CreatePostInput;
  try {
    body = (await req.json()) as CreatePostInput;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    const { postId } = await createPost(auth.uid, body);
    revalidatePath('/home');
    return { success: true, postId };
  } catch (err) {
    if (err instanceof PostValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
