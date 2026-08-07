/**
 * `PUT /api/v1/me/timezone` — record the caller's UTC offset.
 *
 * Body: `{ tzOffsetMinutes: number }` — minutes to ADD to UTC to get local
 * time, i.e. `-new Date().getTimezoneOffset()`. Same convention as
 * `movie-nights-server.ts`, on purpose.
 *
 * PUT rather than PATCH: there is exactly one field and the call is a
 * full statement of it, not a partial merge.
 *
 * The client only sends this when its offset CHANGES (see
 * `timezone-sync.tsx`), so this is not a per-launch write. Phase D0 —
 * exists so the D6 notification policy has something to mean by "10pm".
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { setUserTimezone, isValidTzOffset } from '@/lib/profiles-server';

export const dynamic = 'force-dynamic';

export const PUT = apiRoute(async (req, { auth }) => {
  let body: { tzOffsetMinutes?: unknown };
  try {
    body = (await req.json()) as { tzOffsetMinutes?: unknown };
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (!isValidTzOffset(body?.tzOffsetMinutes)) {
    // Named bounds rather than a bare "invalid": a caller sending seconds, or
    // the un-negated `getTimezoneOffset()`, gets told what the field means.
    throw new BadRequestError(
      'tzOffsetMinutes must be a whole number of minutes between -720 and 840 (minutes to ADD to UTC).',
    );
  }
  await setUserTimezone(auth.uid, body.tzOffsetMinutes);
  return { success: true };
});

export const OPTIONS = optionsHandler;
