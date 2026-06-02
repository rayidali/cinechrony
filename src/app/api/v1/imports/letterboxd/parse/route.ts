/**
 * `POST /api/v1/imports/letterboxd/parse` — phase 1: parse the uploaded
 * Letterboxd export. Body: `{ base64Data, fileName }`. Auth-required
 * (defensive; parsing TMDB-adjacent files isn't user-data sensitive but
 * tying every call to a UID prevents abuse).
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  parseLetterboxdExport,
  LetterboxdValidationError,
} from '@/lib/letterboxd-server';

export const dynamic = 'force-dynamic';

type Body = { base64Data?: unknown; fileName?: unknown };

export const POST = apiRoute(async (req) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.base64Data !== 'string' || typeof body.fileName !== 'string') {
    throw new BadRequestError('base64Data and fileName must be strings.');
  }
  try {
    return await parseLetterboxdExport(body.base64Data, body.fileName);
  } catch (err) {
    if (err instanceof LetterboxdValidationError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
