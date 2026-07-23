/**
 * HTTP-request wrapper for API routes — Phase A foundation (LAUNCH.md A.2.2).
 *
 * Every route under `src/app/api/v1/...` ships its handler through `apiRoute`
 * (auth required) or `publicApiRoute` (no auth). The wrapper centralizes:
 *
 *   1. Bearer-token verification (delegates to the existing `verifyCaller`
 *      in `@/lib/auth-server` — same crypto, same fail-closed posture).
 *   2. Error → HTTP-status mapping via a typed `ApiError` hierarchy. Handlers
 *      throw `new ForbiddenError(...)`; the wrapper renders the right code.
 *   3. The response envelope contract:
 *        success → 2xx + `{ ok: true, data: <handler return> }`
 *        failure → 4xx/5xx + `{ ok: false, error: { code, message } }`
 *      HTTP status carries the success signal for proxies/retries; the
 *      `error.code` is the stable identifier clients branch on.
 *   4. CORS — reflect Origin if it's in the allowlist, set Vary: Origin,
 *      expose the OPTIONS preflight handler. The iOS Share Extension hits
 *      these routes from a Swift URLSession with no Origin header — CORS is
 *      a no-op there by design.
 *
 * Handlers return raw data; the wrapper does the envelope. If a handler
 * needs full control (file downloads, redirects), it can `return new Response`
 * directly — the wrapper passes Response/NextResponse through untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCaller, isAuthError, type VerifiedCaller } from './auth-server';

// ─── Error hierarchy ──────────────────────────────────────────────────────

/**
 * Stable client-facing error codes. The wire contract: `error.code` never
 * changes once shipped — clients branch on it. Add new codes here; don't
 * rename existing ones.
 */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL';

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') { super('UNAUTHORIZED', message); }
}
export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') { super('FORBIDDEN', message); }
}
export class NotFoundError extends ApiError {
  constructor(message = 'Not found') { super('NOT_FOUND', message); }
}
export class BadRequestError extends ApiError {
  constructor(message = 'Bad request') { super('BAD_REQUEST', message); }
}
export class ConflictError extends ApiError {
  constructor(message = 'Conflict') { super('CONFLICT', message); }
}
export class RateLimitedError extends ApiError {
  constructor(message = "You're doing that too fast. Please slow down and try again shortly.") {
    super('RATE_LIMITED', message);
  }
}
export class QuotaExceededError extends ApiError {
  constructor(message = "you're out of scans this week. they refresh monday.") {
    super('QUOTA_EXCEEDED', message);
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────

/**
 * Origins allowed to make cross-origin requests. Returns `true` if the origin
 * should be reflected in `Access-Control-Allow-Origin`.
 *
 * Production + previews are matched by env + suffix; localhost is matched by
 * port-agnostic prefix; `capacitor://localhost` is the iOS WKWebView origin.
 * The iOS Share Extension sends no Origin header at all — it's a Swift
 * URLSession, not a browser — so CORS doesn't gate it.
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  // Production app URL (set via NEXT_PUBLIC_APP_URL in Vercel env).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && origin === appUrl) return true;
  // Vercel preview deployments — *.vercel.app — and our own staging.
  if (origin.endsWith('.vercel.app')) return true;
  // Local dev (Next dev server runs on 9002 by default in this repo).
  if (origin === 'http://localhost:9002' || origin === 'http://127.0.0.1:9002') return true;
  // Capacitor WKWebView (iOS) — bound origin inside the native shell.
  if (origin === 'capacitor://localhost') return true;
  if (origin === 'http://localhost') return true; // Android Capacitor variant
  return false;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = { 'Vary': 'Origin' };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin!;
    headers['Access-Control-Allow-Credentials'] = 'false'; // we use Bearer tokens, not cookies
  }
  return headers;
}

/**
 * Shared OPTIONS preflight handler. Each route file can `export { OPTIONS }`
 * to enable cross-origin POST/PATCH/DELETE from the browser. GET-only routes
 * don't need it (simple requests don't trigger preflight).
 */
export function optionsHandler(req: NextRequest): NextResponse {
  const headers = {
    ...corsHeaders(req),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  return new NextResponse(null, { status: 204, headers });
}

// ─── Response builders ────────────────────────────────────────────────────

export function envelopeSuccess(data: unknown, req: Request, status = 200): NextResponse {
  return NextResponse.json(
    { ok: true, data },
    { status, headers: corsHeaders(req) },
  );
}

function envelopeError(err: ApiError, req: Request): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: err.code, message: err.message } },
    { status: err.status, headers: corsHeaders(req) },
  );
}

export function mapUnknownError(err: unknown, req: Request): NextResponse {
  if (err instanceof ApiError) return envelopeError(err, req);
  // A genuine, unexpected 500 (not one of our typed 4xx ApiErrors) → report it
  // to Sentry (no-op if the DSN is unset) so server crashes stop being invisible.
  Sentry.captureException(err, {
    tags: { source: 'api-route' },
    extra: { url: req.url, method: req.method },
  });
  // Surface the message in dev for debugging; hide it in prod to avoid leaking
  // internals through the wire format. The console always gets the full story.
  console.error('[api] uncaught route error:', err);
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal error'
    : (err instanceof Error ? err.message : String(err));
  return envelopeError(new ApiError('INTERNAL', message), req);
}

// ─── Transient-infra detection (graceful degradation) ─────────────────────

/**
 * True for TRANSIENT infrastructure errors from Firestore (gRPC status codes):
 *   8  RESOURCE_EXHAUSTED — daily read/write quota exceeded (free-tier cap)
 *   14 UNAVAILABLE        — backend briefly unreachable
 *   4  DEADLINE_EXCEEDED  — request timed out
 * These are not logic bugs, so a non-critical read can degrade to empty data
 * instead of 500-ing the whole page. Our own ApiError (auth/forbidden/etc.) and
 * any other error are real and must surface.
 */
function isTransientInfraError(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'number') return code === 8 || code === 14 || code === 4;
  if (typeof code === 'string') {
    return code === 'RESOURCE_EXHAUSTED' || code === 'UNAVAILABLE' || code === 'DEADLINE_EXCEEDED';
  }
  return false;
}

// ─── Auth extraction ──────────────────────────────────────────────────────

/**
 * Pulls a Bearer token out of `Authorization: Bearer <token>`. Returns null
 * if the header is missing or malformed.
 */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * Best-effort client IP for per-IP rate limiting on public routes. On Vercel the
 * platform sets `x-forwarded-for` (client is the FIRST entry) and `x-real-ip`.
 * Returns null when neither is present (local dev / non-proxied) — callers fail
 * open in that case.
 */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || null;
}

/**
 * Verifies a request's Bearer token and returns the verified caller, or null
 * if missing/invalid. Use this from `publicApiRoute` handlers that want
 * caller identity when present but don't require it (e.g. `getListPreview`
 * which shows different data to members vs strangers).
 */
export async function verifyHttpCaller(req: Request): Promise<VerifiedCaller | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  const result = await verifyCaller(token);
  if (isAuthError(result)) return null;
  return result;
}

// ─── Route wrappers ───────────────────────────────────────────────────────

/**
 * Next.js 15 App Router passes the route params as `Promise<P>`. The wrapper's
 * `await` resolves both. We stay strict on `Promise<P>` because Next's
 * build-time route validator inspects the handler signature and rejects
 * union types like `P | Promise<P>`.
 */
type RouteContext<P> = { params: Promise<P> };

type AuthedHandler<P, R> = (
  req: NextRequest,
  ctx: { params: P; auth: VerifiedCaller },
) => Promise<R>;

type PublicHandler<P, R> = (
  req: NextRequest,
  ctx: { params: P; auth: VerifiedCaller | null },
) => Promise<R>;

type RouteOptions<R> = {
  /**
   * When the handler throws a TRANSIENT infrastructure error (Firestore
   * quota/unavailable/deadline — see `isTransientInfraError`), return this
   * value as a normal 200 success instead of a 500. Use for non-critical
   * reads (home rails, badge counts, cache hydrators) so a Firestore blip
   * degrades to quiet/empty UI rather than breaking the page. Writes and
   * critical reads omit it and fail loudly.
   */
  softFallback?: R;
};

/**
 * Wrap an authed route handler. Verifies the Bearer token before invocation,
 * envelopes the return value, maps ApiError throws to the right HTTP status.
 *
 * Usage:
 *   export const POST = apiRoute(async (req, { auth, params }) => {
 *     const body = await req.json();
 *     // ... business logic
 *     return { listId };
 *   });
 *   export const OPTIONS = optionsHandler;
 */
export function apiRoute<P = Record<string, string>, R = unknown>(
  handler: AuthedHandler<P, R>,
  opts: RouteOptions<R> = {},
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const auth = await verifyHttpCaller(req);
      if (!auth) throw new UnauthorizedError();
      const params = (await ctx.params) as P;
      const result = await handler(req, { params, auth });
      if (result instanceof Response) return result;
      return envelopeSuccess(result, req);
    } catch (err) {
      if (opts.softFallback !== undefined && isTransientInfraError(err)) {
        console.error('[api] soft-degraded (transient infra error):', err);
        return envelopeSuccess(opts.softFallback, req);
      }
      return mapUnknownError(err, req);
    }
  };
}

/**
 * Wrap a public (unauthenticated) route handler. Auth is optional — handlers
 * receive `auth: VerifiedCaller | null`. Same envelope + error mapping as
 * `apiRoute`.
 */
export function publicApiRoute<P = Record<string, string>, R = unknown>(
  handler: PublicHandler<P, R>,
  opts: RouteOptions<R> = {},
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const auth = await verifyHttpCaller(req); // null if absent/invalid; not an error
      const params = (await ctx.params) as P;
      const result = await handler(req, { params, auth });
      if (result instanceof Response) return result;
      return envelopeSuccess(result, req);
    } catch (err) {
      if (opts.softFallback !== undefined && isTransientInfraError(err)) {
        console.error('[api] soft-degraded (transient infra error):', err);
        return envelopeSuccess(opts.softFallback, req);
      }
      return mapUnknownError(err, req);
    }
  };
}
