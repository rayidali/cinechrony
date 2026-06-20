/**
 * `POST /api/v1/imports/letterboxd/scrape/import` — Phase 0.7 Wave 7. The chunked
 * import the onboarding client drives, one short request per phase:
 *   { phase: 'films',     films:  ImportFilm[] }  → match (concurrent) + write a chunk
 *   { phase: 'list',      list:   {...} }          → import one custom list
 *   { phase: 'favorites', favorites: [...] }       → set the profile top-5
 *   { phase: 'finalize' }                          → recount the default list
 * Every call is bounded so it fits a serverless function's time budget regardless
 * of total library size. (Distinct from `/imports/letterboxd/import`, the paste
 * importer.)
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import {
  importFilmChunk,
  importUserList,
  setUserFavorites,
  finalizeDefaultList,
  type ImportFilm,
} from '@/lib/letterboxd-username-import-server';
import { TmdbNotConfiguredError } from '@/lib/letterboxd-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Body = {
  phase?: unknown;
  films?: unknown;
  list?: unknown;
  favorites?: unknown;
};

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    switch (body.phase) {
      case 'films':
        return await importFilmChunk(auth.uid, Array.isArray(body.films) ? (body.films as ImportFilm[]) : []);
      case 'list':
        if (!body.list || typeof body.list !== 'object') throw new BadRequestError('list is required.');
        return await importUserList(auth.uid, body.list as Parameters<typeof importUserList>[1]);
      case 'favorites':
        return await setUserFavorites(
          auth.uid,
          Array.isArray(body.favorites) ? (body.favorites as Array<{ name: string; year: string }>) : [],
        );
      case 'finalize':
        return await finalizeDefaultList(auth.uid);
      default:
        throw new BadRequestError('Unknown phase.');
    }
  } catch (err) {
    if (err instanceof TmdbNotConfiguredError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
