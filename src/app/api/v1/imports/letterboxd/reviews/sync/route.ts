/**
 * `POST /api/v1/imports/letterboxd/reviews/sync` — Phase 0.7 Wave 7. Finishes the
 * BACKGROUND reviews import (the browser-actor run is minutes-slow, so it's never
 * part of the onboarding wait). Reads the pending run off the caller's user doc,
 * polls it, and on completion imports the reviews + clears the flag. Returns
 * `running` while the scrape is still going (the client retries). No-op
 * (`status: 'none'`) when there's nothing pending.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { syncPendingReviews } from '@/lib/letterboxd-username-import-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = apiRoute(async (_req, { auth }) => {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return { status: 'none' as const };
  return await syncPendingReviews(auth.uid, token);
});

export const OPTIONS = optionsHandler;
