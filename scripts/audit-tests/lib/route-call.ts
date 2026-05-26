/**
 * Direct route-handler invocation for tests — Phase A foundation.
 *
 * The audit-test runner ships only the Firebase emulator; there's no Next.js
 * dev server, so we can't `fetch('http://localhost:.../api/v1/...')`. Instead,
 * we import the route's exported method handler and call it with a fabricated
 * `NextRequest`. This tests the handler logic (auth, envelope, error mapping)
 * — same surface every endpoint test will assert against.
 *
 * What this does NOT test: Next.js routing, middleware, edge runtime behavior.
 * Those are integration concerns deferred to the preview deploy.
 */

import { NextRequest } from 'next/server';

export type RouteHandler<P = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: P | Promise<P> },
) => Promise<Response>;

export type CallRouteOptions<P> = {
  /** Bearer token to send as `Authorization`. Omit for unauthenticated calls. */
  token?: string;
  /** JSON body to send. Sets Content-Type: application/json. */
  body?: unknown;
  /** Route params (e.g. `{ id: 'list-123' }`). Defaults to `{}`. */
  params?: P;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Override the request URL (defaults to `http://test/api/v1/_test`).
   *  Use to put values into searchParams. */
  url?: string;
};

export type RouteCallResult<T> = {
  status: number;
  /** Parsed envelope. `ok: true` → success with `data`; `ok: false` → `error`. */
  body: { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
  headers: Headers;
};

/**
 * Invoke a route handler with a synthetic request and parse the envelope.
 * Throws only on transport-level failure (the handler crashed). Both 2xx
 * and 4xx/5xx envelopes resolve normally — the caller asserts on `status`
 * and `body`.
 */
export async function callRoute<T = unknown, P = Record<string, string>>(
  handler: RouteHandler<P>,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS',
  options: CallRouteOptions<P> = {},
): Promise<RouteCallResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const req = new NextRequest(options.url ?? 'http://test/api/v1/_test', {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const params = (options.params ?? ({} as P));
  const res = await handler(req, { params });

  // 204 / empty body → still produce an envelope-shaped result for uniform asserts.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {
      status: res.status,
      body: { ok: true, data: undefined as T },
      headers: res.headers,
    };
  }

  const text = await res.text();
  let parsed: RouteCallResult<T>['body'];
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Route returned non-JSON body (status ${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
