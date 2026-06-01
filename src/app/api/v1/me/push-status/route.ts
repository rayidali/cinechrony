/**
 * `GET /api/v1/me/push-status` — `{ enabled }` flag for the prompt UI.
 * Driven by whether the user has any active push subscription.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getPushStatus } from '@/lib/notifications-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getPushStatus(auth.uid);
});

export const OPTIONS = optionsHandler;
