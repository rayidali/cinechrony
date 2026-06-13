/**
 * `POST /api/v1/notifications/read` — mark notifications as read.
 *
 * Body: `{ ids?: string[] }`. Omit `ids` to mark ALL unread; provide ids
 * to mark a specific subset (server filters to only those that belong to
 * the caller — per-doc ownership check defends against a malicious client
 * trying to flip another user's state).
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { markNotificationsRead } from '@/lib/notifications-server';

export const dynamic = 'force-dynamic';

type Body = { ids?: string[] };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body = {};
  try {
    if (req.headers.get('content-length') !== '0' && req.headers.get('content-type')?.includes('json')) {
      body = (await req.json()) as Body;
    }
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.every((s) => typeof s === 'string')) {
      throw new BadRequestError('ids must be an array of strings.');
    }
  }
  await markNotificationsRead(auth.uid, body.ids);
  return { success: true };
});

export const OPTIONS = optionsHandler;
