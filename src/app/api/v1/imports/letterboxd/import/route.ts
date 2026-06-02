/**
 * `POST /api/v1/imports/letterboxd/import` — phase 3 (paste-import): write
 * the user-confirmed matches into the caller's default list. Body:
 * `{ matchedMovies }`. Caller UID from Bearer token. AUDIT 2.2: movieCount
 * is recounted and SET after the batch writes — idempotent + self-healing.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { importMatchedMovies, type MatchedMovie } from '@/lib/letterboxd-server';

export const dynamic = 'force-dynamic';

type Body = { matchedMovies?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!Array.isArray(body.matchedMovies)) {
    throw new BadRequestError('matchedMovies must be an array.');
  }
  return importMatchedMovies(auth.uid, body.matchedMovies as MatchedMovie[]);
});

export const OPTIONS = optionsHandler;
