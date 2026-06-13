/**
 * `POST /api/v1/me/profile` — onboarding finalize (the user picked a
 * username; create or update their profile + default list).
 *
 * Body: `{ email, username, displayName? }`. Caller UID from Bearer
 * token. Returns `{ defaultListId }`.
 */

import {
  apiRoute,
  optionsHandler,
  BadRequestError,
  ConflictError,
} from '@/lib/api-handler';
import {
  createUserProfileWithUsername,
  UsernameFormatError,
  UsernameTakenError,
} from '@/lib/profiles-server';

export const dynamic = 'force-dynamic';

type Body = { email?: unknown; username?: unknown; displayName?: unknown };

export const POST = apiRoute(async (req, { auth }) => {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  if (typeof body.email !== 'string' || typeof body.username !== 'string') {
    throw new BadRequestError('email and username must be strings.');
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName : null;

  try {
    const { defaultListId } = await createUserProfileWithUsername(
      auth.uid,
      body.email,
      body.username,
      displayName,
    );
    return { success: true, defaultListId };
  } catch (err) {
    if (err instanceof UsernameFormatError) throw new BadRequestError(err.message);
    if (err instanceof UsernameTakenError) throw new ConflictError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
