/**
 * `POST /api/v1/ratings` — create or update the caller's rating for a
 * movie/TV show. Idempotent: re-rating mutates the same doc.
 *
 * Body: `{ tmdbId, mediaType, movieTitle, moviePosterUrl?, rating }`
 *   rating: 1.0–10.0, rounded to one decimal.
 * Returns: `{ rating, isNew }`. Emits a `rated` activity on first rating.
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  createOrUpdateRating,
  RatingValidationError,
  type CreateRatingInput,
} from '@/lib/ratings-server';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  let body: Partial<CreateRatingInput>;
  try {
    body = (await req.json()) as Partial<CreateRatingInput>;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  if (typeof body.tmdbId !== 'number') throw new BadRequestError('tmdbId is required.');
  if (body.mediaType !== 'movie' && body.mediaType !== 'tv') {
    throw new BadRequestError('mediaType must be "movie" or "tv".');
  }
  if (typeof body.movieTitle !== 'string') throw new BadRequestError('movieTitle is required.');
  if (typeof body.rating !== 'number') throw new BadRequestError('rating is required.');

  try {
    const { rating, isNew } = await createOrUpdateRating(auth.uid, {
      tmdbId: body.tmdbId,
      mediaType: body.mediaType,
      movieTitle: body.movieTitle,
      moviePosterUrl: typeof body.moviePosterUrl === 'string' ? body.moviePosterUrl : undefined,
      rating: body.rating,
    });
    revalidatePath('/profile');
    return { success: true, rating, isNew };
  } catch (err) {
    if (err instanceof RatingValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
