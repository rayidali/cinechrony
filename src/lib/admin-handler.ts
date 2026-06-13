/**
 * `adminRoute<>` — wraps an admin endpoint with an `x-admin-token` check.
 *
 * Phase A PR #16: unifies the admin auth model. Legacy `/api/admin/*`
 * routes used a mix of `ADMIN_SECRET_TOKEN` (header check) and
 * `ADMIN_SECRET` (action-level recheck). The new model is **one env var**
 * (`ADMIN_SECRET`), **one check** (the route layer), **constant-time**
 * comparison via `crypto.timingSafeEqual`.
 *
 * Behavior:
 *   - `NODE_ENV === 'development'` AND `ADMIN_SECRET` unset → allow without
 *     a token (local-dev convenience: `curl localhost:9002/api/v1/admin/...`).
 *   - Otherwise: require `x-admin-token` header to equal `ADMIN_SECRET`,
 *     compared timing-safely. Missing/wrong token → 401. Server with no
 *     `ADMIN_SECRET` set in production → 500 ("server misconfigured" —
 *     fail closed rather than allow).
 *   - Same envelope + error mapping as `apiRoute`.
 *
 * Note: this is NOT a Bearer-token route — admin endpoints aren't called
 * by user clients. There's no `auth` context delivered to the handler;
 * the caller is "the admin/operator" and that's that.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  envelopeSuccess,
  mapUnknownError,
  UnauthorizedError,
  ApiError,
} from '@/lib/api-handler';

type RouteContext<P> = { params: Promise<P> };

type AdminHandler<P, R> = (
  req: NextRequest,
  ctx: { params: P },
) => Promise<R | Response>;

class AdminMisconfiguredError extends ApiError {
  constructor() {
    super('INTERNAL', 'Server misconfigured: ADMIN_SECRET not set.');
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  // Pad to the same length so timingSafeEqual doesn't throw. The padding
  // doesn't leak length info because both buffers are the same size, and
  // the equality returns false anyway when lengths differ.
  const len = Math.max(a.length, b.length, 1);
  const aBuf = Buffer.alloc(len);
  const bBuf = Buffer.alloc(len);
  aBuf.write(a);
  bBuf.write(b);
  return a.length === b.length && timingSafeEqual(aBuf, bBuf);
}

function checkAdminAuth(req: Request): void {
  const isDev = process.env.NODE_ENV === 'development';
  const expected = process.env.ADMIN_SECRET;
  const provided = req.headers.get('x-admin-token') ?? '';

  // Dev convenience: when ADMIN_SECRET is unset in development, allow without
  // a token. Any other env (production, test) requires the secret to be set
  // AND the header to match.
  if (isDev && !expected) return;

  if (!expected) throw new AdminMisconfiguredError();
  if (!provided || !constantTimeEqual(provided, expected)) {
    throw new UnauthorizedError('Invalid admin token.');
  }
}

/**
 * Wrap an admin route handler. Throws (mapped to envelopes) on missing or
 * wrong `x-admin-token`. No user-auth context — admin routes aren't
 * caller-scoped.
 */
export function adminRoute<P = Record<string, string>, R = unknown>(
  handler: AdminHandler<P, R>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      checkAdminAuth(req);
      const params = (await ctx.params) as P;
      const result = await handler(req, { params });
      if (result instanceof Response) return result;
      return envelopeSuccess(result, req);
    } catch (err) {
      return mapUnknownError(err, req);
    }
  };
}
