/**
 * `GET /api/v1/me/scan-quota` — the caller's weekly AI-scan quota:
 * `{ limit, used, remaining, week, resetsAt }`. Free tier is 7/week
 * (`SCAN_WEEKLY_LIMIT`-overridable), resetting Monday 00:00 UTC. See
 * `getScanQuota` in `extraction-server.ts`.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getScanQuota } from '@/lib/extraction-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => getScanQuota(auth.uid));

export const OPTIONS = optionsHandler;
