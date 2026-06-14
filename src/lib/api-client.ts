/**
 * Client-side helper for calling `/api/v1/*` routes — Phase A foundation
 * (LAUNCH.md A.2.3). This is what replaces every existing
 * `import { someAction } from '@/app/actions'` over the next 12 PRs.
 *
 * Contract (matches `src/lib/api-handler.ts`):
 *   - Attaches `Authorization: Bearer <id-token>` automatically when a user
 *     is signed in (via Firebase Auth's `currentUser.getIdToken()`).
 *   - JSON-encodes the body and sets `Content-Type` accordingly.
 *   - Parses the `{ ok, data | error }` envelope.
 *   - Returns the unwrapped `data` on success.
 *   - Throws `ApiClientError` on failure — callers branch on `err.code` (a
 *     stable string like `RATE_LIMITED`, `FORBIDDEN`, `BAD_REQUEST`).
 *
 * The token is fetched lazily on each call; Firebase Auth caches and refreshes
 * tokens internally, so no separate caching is needed here.
 */

import { getAuth } from 'firebase/auth';
import type { ApiErrorCode } from './api-handler';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | 'NETWORK' | 'PARSE';
  readonly status: number; // 0 for network/parse errors
  constructor(code: ApiErrorCode | 'NETWORK' | 'PARSE', message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type EnvelopeOk<T> = { ok: true; data: T };
type EnvelopeErr = { ok: false; error: { code: ApiErrorCode; message: string } };
type Envelope<T> = EnvelopeOk<T> | EnvelopeErr;

type CallOptions = {
  /** Force a token refresh before this call. Use for auth-state-sensitive
   *  operations (account deletion, etc.). Default false. */
  forceTokenRefresh?: boolean;
  /** Skip auth even if a user is signed in (for explicit public endpoints).
   *  Default false — token attached automatically when available. */
  skipAuth?: boolean;
  /** Extra headers to merge in. Authorization and Content-Type are managed
   *  by this helper — overriding them is not supported. */
  headers?: Record<string, string>;
  /** Abort controller signal — passed through to fetch. */
  signal?: AbortSignal;
};

async function attachAuthHeader(
  headers: Record<string, string>,
  forceTokenRefresh: boolean,
): Promise<void> {
  try {
    const user = getAuth().currentUser;
    if (!user) return;
    const token = await user.getIdToken(forceTokenRefresh);
    headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // Token fetch failed (network, revoked, etc.) — let the server respond
    // 401 rather than throwing here. The caller decides how to handle.
  }
}

/**
 * Make a typed call to `/api/v1/*`.
 *
 * @example
 *   const { listId } = await apiCall<{ listId: string }>('POST', '/api/v1/lists', { name });
 *
 * @example
 *   try {
 *     await apiCall('POST', `/api/v1/users/${uid}/follow`);
 *   } catch (err) {
 *     if (err instanceof ApiClientError && err.code === 'RATE_LIMITED') {
 *       toast.error(err.message);
 *     } else throw err;
 *   }
 */
export async function apiCall<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.skipAuth) await attachAuthHeader(headers, opts.forceTokenRefresh === true);

  // Phase A PR #17 — when the bundle is the static export (Capacitor or
  // a separate static host), API calls must hit the Vercel-deployed API
  // origin instead of `self`. `NEXT_PUBLIC_API_BASE_URL` is the override;
  // unset (the default — and the only setting the Vercel deploy uses)
  // means same-origin, which preserves Phase A pre-#17 behavior. Only
  // `path`s starting with `/` get prefixed; absolute URLs pass through.
  // Resolve the API origin:
  //  • NEXT_PUBLIC_API_BASE_URL (Capacitor static build) always wins.
  //  • On a Vercel PREVIEW deployment, same-origin calls hit the Deployment-
  //    Protection wall — this client sends no cookies (Bearer auth only), so
  //    the Vercel SSO cookie never accompanies the fetch and the wall returns
  //    a non-JSON 401. Route preview API calls to the PUBLIC production origin
  //    instead (routes export OPTIONS + the CORS allowlist permits *.vercel.app).
  //    Vercel injects these NEXT_PUBLIC_VERCEL_* vars (System Environment
  //    Variables, on by default). Production + localhost + native stay same-origin.
  const explicitBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previewBase =
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview' &&
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
      : '';
  const apiBase = (explicitBase || previewBase || '').replace(/\/$/, '');
  const url = apiBase && path.startsWith('/') ? `${apiBase}${path}` : path;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
      // Bearer auth — no cookies needed. `same-origin` is fine for web; for
      // Capacitor the request is cross-origin to the API host but cookies
      // aren't used either way.
      credentials: 'omit',
    });
  } catch (err) {
    throw new ApiClientError(
      'NETWORK',
      err instanceof Error ? err.message : 'Network error',
      0,
    );
  }

  // The route handler always returns JSON (envelope or otherwise). 204 has no
  // body — treat it as success with empty data.
  if (res.status === 204) return undefined as T;

  let parsed: Envelope<T>;
  try {
    parsed = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError('PARSE', `Invalid JSON response (HTTP ${res.status})`, res.status);
  }

  if (parsed && typeof parsed === 'object' && parsed.ok === true) {
    return parsed.data;
  }
  if (parsed && typeof parsed === 'object' && parsed.ok === false) {
    throw new ApiClientError(parsed.error.code, parsed.error.message, res.status);
  }
  throw new ApiClientError('PARSE', `Malformed envelope (HTTP ${res.status})`, res.status);
}
