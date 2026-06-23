/**
 * `POST /api/v1/imports/letterboxd/scrape/start` — Phase 0.7 Wave 7. Kicks off
 * the Apify cheerio scrape (no reviews) and returns the run + dataset ids
 * immediately. The client then polls `/scrape/status`. Graceful when APIFY_TOKEN
 * is unset (`{ available: false }`).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { startLibraryScrape, LetterboxdUsernameError } from '@/lib/letterboxd-username-import-server';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req) => {
  let body: { username?: unknown };
  try {
    body = (await req.json()) as { username?: unknown };
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) throw new BadRequestError('username is required.');

  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return { available: false as const };

  try {
    const { runId, datasetId } = await startLibraryScrape(username, token);
    return { available: true as const, runId, datasetId };
  } catch (err) {
    if (err instanceof LetterboxdUsernameError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
