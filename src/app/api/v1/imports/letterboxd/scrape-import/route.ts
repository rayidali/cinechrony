/**
 * `POST /api/v1/imports/letterboxd/scrape-import` — the real username import for
 * onboarding (Phase 0.7 Wave 7). Scrapes a public Letterboxd library via Apify
 * then imports it into the caller's account, reusing the TMDB-match + write
 * pipeline. Auth required (the account exists by this step — onboarding is
 * account-last).
 *
 * GRACEFUL DEGRADATION: if `APIFY_TOKEN` isn't provisioned we return
 * `{ available: false, importedCount: 0, ... }` (a normal 200) so the onboarding
 * import screen can skip cleanly instead of hard-failing. A malformed username
 * is a 400; everything else surfaces normally.
 *
 * The scrape can take ~30–60s for a large diary, so the import-progress screen
 * keeps this request alive (a backgrounded fetch would be killed on navigation).
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  importLetterboxdFromUsername,
  LetterboxdUsernameError,
} from '@/lib/letterboxd-scrape-server';

export const dynamic = 'force-dynamic';
// Allow the Apify scrape + TMDB-match + write to run to completion.
export const maxDuration = 300;

type Result = {
  available: boolean;
  importedCount: number;
  reviewsImported: number;
  favoritesImported: number;
  listsCreated: number;
};

export const POST = apiRoute(async (req, { auth }): Promise<Result> => {
  let body: { username?: unknown };
  try {
    body = (await req.json()) as { username?: unknown };
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) throw new BadRequestError('username is required.');

  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    // Scrape engine not provisioned — let the client skip the import gracefully.
    return { available: false, importedCount: 0, reviewsImported: 0, favoritesImported: 0, listsCreated: 0 };
  }

  try {
    // skipReviews: the reviews browser-actor is minutes-slow (sequential Chromium
    // passes clearing Cloudflare) and would blow the serverless time budget.
    // Onboarding pulls films/ratings/watchlist/lists/favourites (fast cheerio run);
    // reviews can be back-filled later via the ZIP importer.
    const result = await importLetterboxdFromUsername(auth.uid, username, { token, skipReviews: true });
    return {
      available: true,
      importedCount: result.importedCount ?? 0,
      reviewsImported: result.reviewsImported ?? 0,
      favoritesImported: result.favoritesImported ?? 0,
      listsCreated: result.listsCreated ?? 0,
    };
  } catch (err) {
    if (err instanceof LetterboxdUsernameError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
