/**
 * `POST /api/v1/me/ensure` — idempotent "make sure I have a profile +
 * default list, migrate legacy fields if needed". Called on every
 * authenticated boot.
 *
 * Body: `{ email, displayName? }`. Caller UID from Bearer token. Returns
 * `{ defaultListId }`.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import { ensureUserProfile } from '@/lib/profiles-server';

export const dynamic = 'force-dynamic';

type Body = { email?: unknown; displayName?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.email !== 'string') {
    throw new BadRequestError('email must be a string.');
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName : null;
  return ensureUserProfile(auth.uid, body.email, displayName);
});

export const OPTIONS = optionsHandler;
