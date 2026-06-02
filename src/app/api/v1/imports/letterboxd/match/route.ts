/**
 * `POST /api/v1/imports/letterboxd/match` — phase 2 (paste-import): parse
 * free text → TMDB-matched candidates. Body: `{ text }`. Auth-required.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  parseAndMatchMovies,
  LetterboxdValidationError,
  TmdbNotConfiguredError,
} from '@/lib/letterboxd-server';

export const dynamic = 'force-dynamic';

type Body = { text?: unknown };

export const POST = apiRoute(async (req) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.text !== 'string') {
    throw new BadRequestError('text must be a string.');
  }
  try {
    return await parseAndMatchMovies(body.text);
  } catch (err) {
    if (err instanceof LetterboxdValidationError) throw new BadRequestError(err.message);
    if (err instanceof TmdbNotConfiguredError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
