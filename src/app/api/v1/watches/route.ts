/**
 * `/api/v1/watches` — the caller's watch log (F03 "how was it?" + "your history").
 *
 * POST  body `{ tmdbId, mediaType, movieTitle, moviePosterUrl?, rating?, note?,
 *               watchedAt? }` → logs a viewing event. Best-effort upserts the
 *               canonical rating + the caller's public review. Returns `{ watch }`.
 * GET   `?tmdbId=` → `{ watches }` (caller's watches for the film, newest first).
 *
 * Owner-scoped: a watch is always written/read under the authenticated caller.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  logWatch,
  getWatchesForMovie,
  WatchValidationError,
  type LogWatchInput,
} from '@/lib/watches-server';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  let body: Partial<LogWatchInput>;
  try {
    body = (await req.json()) as Partial<LogWatchInput>;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  if (typeof body.tmdbId !== 'number') throw new BadRequestError('tmdbId is required.');
  if (body.mediaType !== 'movie' && body.mediaType !== 'tv') {
    throw new BadRequestError('mediaType must be "movie" or "tv".');
  }
  if (typeof body.movieTitle !== 'string') throw new BadRequestError('movieTitle is required.');

  try {
    const { watch } = await logWatch(auth.uid, {
      tmdbId: body.tmdbId,
      mediaType: body.mediaType,
      movieTitle: body.movieTitle,
      moviePosterUrl: typeof body.moviePosterUrl === 'string' ? body.moviePosterUrl : null,
      rating: typeof body.rating === 'number' ? body.rating : null,
      note: typeof body.note === 'string' ? body.note : null,
      watchedAt: typeof body.watchedAt === 'string' ? body.watchedAt : undefined,
    });
    return { success: true, watch };
  } catch (err) {
    if (err instanceof WatchValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const GET = apiRoute(async (req, { auth }) => {
  const tmdbId = Number(new URL(req.url).searchParams.get('tmdbId'));
  if (!tmdbId || Number.isNaN(tmdbId)) throw new BadRequestError('tmdbId is required.');
  return getWatchesForMovie(auth.uid, tmdbId);
}, { softFallback: { watches: [] } });

export const OPTIONS = optionsHandler;
