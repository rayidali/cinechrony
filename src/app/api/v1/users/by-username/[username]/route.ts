/**
 * `GET /api/v1/users/by-username/[username]` — public-profile lookup.
 * Public. Email is never returned (lives in `/users_private`, AUDIT 1.9).
 */

import {
  publicApiRoute,
  optionsHandler,
  NotFoundError,
} from '@/lib/api-handler';
import { getUserByUsername, UserNotFoundError } from '@/lib/profiles-server';

export const dynamic = 'force-dynamic';

type RouteParams = { username: string };

export const GET = publicApiRoute<RouteParams>(async (_req, { params }) => {
  try {
    return await getUserByUsername(params.username);
  } catch (err) {
    if (err instanceof UserNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
