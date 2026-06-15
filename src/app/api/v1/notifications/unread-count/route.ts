/**
 * `GET /api/v1/notifications/unread-count` — `{ count }` for the bell badge.
 * Caller-scoped via Bearer token; uses Firestore `count()` aggregate.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getUnreadNotificationCount } from '@/lib/notifications-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getUnreadNotificationCount(auth.uid);
}, { softFallback: { count: 0 } });

export const OPTIONS = optionsHandler;
