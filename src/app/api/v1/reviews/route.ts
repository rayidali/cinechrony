/**
 * `/api/v1/reviews` — POST create + GET list (by tmdbId).
 *
 *  POST  body: `{ tmdbId, mediaType, movieTitle, moviePosterUrl?, text,
 *               ratingAtTime?, parentId?, hasSpoiler? }`
 *        → `{ review }`. Rate-limited (AUDIT.md 3.8 — `review` bucket).
 *        Side effects: @-mention notifications, reply notification (if
 *        `parentId`), `reviewed` activity (top-level only).
 *
 *  GET   query: `tmdbId` (required) + optional `sort=recent|likes`,
 *        `limit` (1–100, default 50), `cursor` (last review doc id).
 *        Returns: `{ reviews, hasMore, nextCursor? }`. Top-level reviews
 *        only — replies fetched via `/[id]/replies`. Closes AUDIT 3.10
 *        for the top-level read path.
 *
 * GET is `publicApiRoute` — reviews on a movie are public reading.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  publicApiRoute,
  optionsHandler,
  BadRequestError,
  NotFoundError,
} from '@/lib/api-handler';
import {
  createReview,
  getMovieReviews,
  ReviewValidationError,
  UserNotFoundError,
  type CreateReviewInput,
} from '@/lib/reviews-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ─── POST /api/v1/reviews ────────────────────────────────────────────────

export const POST = apiRoute(async (req, { auth }) => {
  // AUDIT.md 3.8: cap scripted review/comment + mention-notification spam.
  const rl = await checkRateLimit(auth.uid, 'review');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: Partial<CreateReviewInput>;
  try {
    body = (await req.json()) as Partial<CreateReviewInput>;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  if (typeof body.tmdbId !== 'number') throw new BadRequestError('tmdbId is required.');
  if (body.mediaType !== 'movie' && body.mediaType !== 'tv') {
    throw new BadRequestError('mediaType must be "movie" or "tv".');
  }
  if (typeof body.movieTitle !== 'string') throw new BadRequestError('movieTitle is required.');
  if (typeof body.text !== 'string') throw new BadRequestError('text is required.');

  try {
    const { review } = await createReview(auth.uid, {
      tmdbId: body.tmdbId,
      mediaType: body.mediaType,
      movieTitle: body.movieTitle,
      moviePosterUrl: typeof body.moviePosterUrl === 'string' ? body.moviePosterUrl : undefined,
      text: body.text,
      ratingAtTime: body.ratingAtTime ?? undefined,
      parentId: typeof body.parentId === 'string' ? body.parentId : null,
      hasSpoiler: !!body.hasSpoiler,
    });
    revalidatePath(`/movie/${body.tmdbId}/comments`);
    return { success: true, review };
  } catch (err) {
    if (err instanceof ReviewValidationError) throw new BadRequestError(err.message);
    if (err instanceof UserNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

// ─── GET /api/v1/reviews?tmdbId=&sort=&limit=&cursor= ───────────────────

export const GET = publicApiRoute(async (req) => {
  const url = new URL(req.url);
  const tmdbIdRaw = url.searchParams.get('tmdbId');
  const tmdbId = tmdbIdRaw ? Number.parseInt(tmdbIdRaw, 10) : NaN;
  if (!Number.isFinite(tmdbId)) {
    throw new BadRequestError('tmdbId query param is required.');
  }
  const sort = url.searchParams.get('sort');
  const sortBy: 'recent' | 'likes' = sort === 'likes' ? 'likes' : 'recent';
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;

  const result = await getMovieReviews(tmdbId, {
    sortBy,
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
  });
  return result;
}, { softFallback: { reviews: [], hasMore: false } });

export const OPTIONS = optionsHandler;
