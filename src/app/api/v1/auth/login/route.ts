/**
 * `POST /api/v1/auth/login` — Phase 0.7 Wave 7. Resolves an email-or-@username
 * login and returns a Firebase custom token for `signInWithCustomToken`. Public
 * (no Bearer — the caller isn't signed in yet). All failures collapse to 401 with
 * a generic message (no account-existence oracle).
 */

import {
  publicApiRoute,
  optionsHandler,
  clientIp,
  BadRequestError,
  UnauthorizedError,
  RateLimitedError,
} from '@/lib/api-handler';
import { checkIpRateLimit } from '@/lib/rate-limit';
import { loginWithIdentifier, InvalidCredentialsError } from '@/lib/auth-login-server';

export const dynamic = 'force-dynamic';

export const POST = publicApiRoute(async (req) => {
  // Brute-force / credential-stuffing guard. This endpoint proxies Firebase
  // Identity Toolkit through the server IP, which dilutes Firebase's own
  // per-IP throttling, and the uid-keyed limiter can't cover a pre-auth caller
  // — so a per-IP cap here is the only app-level brake. Also caps the up-to-3
  // Firestore reads per attempt (username→email resolution).
  if (!checkIpRateLimit(clientIp(req), 'authLogin', { limit: 10, windowMs: 5 * 60_000 })) {
    throw new RateLimitedError('Too many login attempts. Please wait a few minutes and try again.');
  }
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
