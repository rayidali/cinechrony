/**
 * `POST /api/v1/admin/movie-nights-tick` — the S2 movie-night ticker
 * (MOVIE-NIGHT-PLAN.md § locked decision 3). Invoked every 10 minutes by
 * `.github/workflows/movie-nights-tick.yml` (no paid Vercel cron needed).
 * Sends reminder + morning-after check-in pushes behind transactional
 * claims; never mutates a night's lifecycle status. Idempotent — a lagging
 * or overlapping run never double-sends (see `tickMovieNights`).
 */

import { adminRoute } from '@/lib/admin-handler';
import { tickMovieNights } from '@/lib/movie-nights-server';

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  return tickMovieNights();
});
