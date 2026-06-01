/**
 * `GET /api/v1/notifications?cursor=&limit=` — list caller's notifications.
 *
 * Cursor pagination over `/notifications` filtered to the caller (UID from
 * the Bearer token). Block-filtered server-side. Newest-first.
 *
 * Closes a pre-migration auth gap: the legacy `getNotifications(userId)`
 * Server Action trusted a userId arg, letting any client read any user's
 * notifications. The route derives identity from the verified token only.
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { listNotifications } from '@/lib/notifications-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req, { auth }) => {
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  return listNotifications(auth.uid, {
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
});

export const OPTIONS = optionsHandler;
