/**
 * `GET /api/v1/me/blocked-users` — full UserProfile[] for the settings
 * unblock list. Email is never returned (AUDIT 1.9 — lives in
 * `/users_private`).
 */

import { apiRoute, optionsHandler } from '@/lib/api-handler';
import { getBlockedUsers } from '@/lib/blocks-server';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (_req, { auth }) => {
  return getBlockedUsers(auth.uid);
});

export const OPTIONS = optionsHandler;
