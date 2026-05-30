/**
 * `POST /api/v1/lists/[ownerId]/[listId]/movies` — add a movie to a list.
 *
 * Body: `{ movieData, socialLink?, note?, status? }`
 *
 *   movieData: SearchResult (TMDB-shaped)
 *   socialLink: string (TikTok/IG/YT URL, optional)
 *   note: string (the caller's note, optional)
 *   status: 'To Watch' | 'Watched' (defaults to 'To Watch')
 *
 * Returns: `{ movieId, isNew }` — `isNew=false` on idempotent re-add.
 *
 * Closes LAUNCH.md A.3.8 + AUDIT.md 2.2 (transactional movieCount).
 */

import { revalidatePath } from 'next/cache';
import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ForbiddenError,
} from '@/lib/api-handler';
import {
  addMovieToList,
  ListAccessDeniedError,
  MovieValidationError,
  type AddMovieInput,
} from '@/lib/movies-server';

export const dynamic = 'force-dynamic';

type RouteParams = { ownerId: string; listId: string };

type AddMovieBody = Partial<AddMovieInput>;

export const POST = apiRoute<RouteParams>(async (req, { auth, params }) => {
  let body: AddMovieBody;
  try {
    body = (await req.json()) as AddMovieBody;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!body?.movieData || typeof body.movieData !== 'object') {
    throw new BadRequestError('movieData is required.');
  }

  try {
    const { movieId, isNew } = await addMovieToList(
      auth.uid,
      params.ownerId,
      params.listId,
      {
        movieData: body.movieData,
        socialLink: typeof body.socialLink === 'string' ? body.socialLink : undefined,
        note: typeof body.note === 'string' ? body.note : undefined,
        status: body.status,
      },
    );
    revalidatePath(`/lists/${params.listId}`);
    return { success: true, movieId, isNew };
  } catch (err) {
    if (err instanceof MovieValidationError) throw new BadRequestError(err.message);
    if (err instanceof ListAccessDeniedError) throw new ForbiddenError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
