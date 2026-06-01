/**
 * `/api/v1/me/notification-preferences` — GET (read) + PATCH (merge-update).
 *
 *  GET   → `{ preferences }` with defaults filled in for any unset keys.
 *  PATCH body: partial preferences object — only known boolean keys are
 *        accepted; unknown keys are dropped server-side.
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/notifications-server';
import type { NotificationPreferences } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getNotificationPreferences(auth.uid);
});

export const PATCH = apiRoute(async (req, { auth }) => {
  let body: Partial<NotificationPreferences>;
  try {
    body = (await req.json()) as Partial<NotificationPreferences>;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!body || typeof body !== 'object') {
    throw new BadRequestError('Body must be an object.');
  }
  await updateNotificationPreferences(auth.uid, body);
  return { success: true };
});

export const OPTIONS = optionsHandler;
