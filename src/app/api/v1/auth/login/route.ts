/**
 * `POST /api/v1/auth/login` — Phase 0.7 Wave 7. Resolves an email-or-@username
 * login and returns a Firebase custom token for `signInWithCustomToken`. Public
 * (no Bearer — the caller isn't signed in yet). All failures collapse to 401 with
 * a generic message (no account-existence oracle).
 */

import {
  publicApiRoute,
  optionsHandler,
  BadRequestError,
  UnauthorizedError,
} from '@/lib/api-handler';
import { loginWithIdentifier, InvalidCredentialsError } from '@/lib/auth-login-server';

export const dynamic = 'force-dynamic';

export const POST = publicApiRoute(async (req) => {
  let body: { identifier?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  const identifier = typeof body.identifier === 'string' ? body.identifier : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) {
    throw new BadRequestError('identifier and password are required.');
  }
  try {
    return await loginWithIdentifier(identifier, password);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) throw new UnauthorizedError(err.message);
    throw err;
  }
});

export const OPTIONS = optionsHandler;
