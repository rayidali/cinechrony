/**
 * `GET /api/v1/imports/letterboxd/scrape/status?runId=&datasetId=` — Phase 0.7
 * Wave 7. Quick status poll for the cheerio scrape. When the run has SUCCEEDED,
 * also returns the normalized + deduped import library (films/lists/favourites)
 * so the client can begin chunked importing. Each call is short (a status check
 * + a one-shot dataset fetch on completion).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { pollLibraryScrape } from '@/lib/letterboxd-username-import-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req) => {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  const datasetId = url.searchParams.get('datasetId');
  if (!runId || !datasetId) throw new BadRequestError('runId and datasetId are required.');

  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return { status: 'failed' as const, itemCount: 0 };

  return await pollLibraryScrape(runId, datasetId, token);
});

export const OPTIONS = optionsHandler;
