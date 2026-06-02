/**
 * `POST /api/v1/imports/letterboxd/full` — one-shot pipeline: takes the
 * structured Letterboxd data (from `/parse`) + import options, runs TMDB
 * matching for everything (watched + watchlist + ratings + reviews +
 * custom lists + profile favorites), writes it all. Caller UID from
 * Bearer token. AUDIT 2.2 preserved — recount + SET movieCount.
 *
 * This is what the settings "import everything" button calls.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  importLetterboxdMovies,
  TmdbNotConfiguredError,
  type LetterboxdImportOptions,
} from '@/lib/letterboxd-server';

export const dynamic = 'force-dynamic';

type Body = { data?: unknown; options?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!body.data || typeof body.data !== 'object') {
    throw new BadRequestError('data is required.');
  }
  if (!body.options || typeof body.options !== 'object') {
    throw new BadRequestError('options is required.');
  }
  try {
    return await importLetterboxdMovies(
      auth.uid,
      body.data as Parameters<typeof importLetterboxdMovies>[1],
      body.options as LetterboxdImportOptions,
    );
  } catch (err) {
    if (err instanceof TmdbNotConfiguredError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
