/**
 * `GET /api/v1/usernames/[username]/available` — onboarding availability
 * check. Public. Returns `{ available, suggestions }`. Invalid format
 * → 400 (UsernameFormatError).
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
} from '@/lib/api-handler';
import {
  checkUsernameAvailability,
  UsernameFormatError,
} from '@/lib/profiles-server';

export const dynamic = 'force-dynamic';

type RouteParams = { username: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  try {
    return await checkUsernameAvailability(params.username);
  } catch (err) {
    if (err instanceof UsernameFormatError) throw new BadRequestError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
