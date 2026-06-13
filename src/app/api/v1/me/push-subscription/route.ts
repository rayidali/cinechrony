/**
 * `/api/v1/me/push-subscription` — POST (upsert) + DELETE (remove).
 *
 *  POST   body: `{ endpoint, keys: { p256dh, auth } }` — rate-limited via
 *         the `pushSubscribe` bucket (AUDIT.md 3.8). Idempotent by endpoint.
 *  DELETE body: `{ endpoint }` — removes that single subscription.
 *
 * Caller identity comes from the verified Bearer token; UID is never
 * accepted in the body.
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import {
  savePushSubscription,
  removePushSubscription,
  PushSubscriptionValidationError,
} from '@/lib/notifications-server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req, { auth }) => {
  const rl = await checkRateLimit(auth.uid, 'pushSubscribe');
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: rl.error } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  try {
    await savePushSubscription(auth.uid, body);
    return { success: true };
  } catch (err) {
    if (err instanceof PushSubscriptionValidationError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  }
});

export const DELETE = apiRoute(async (req, { auth }) => {
  let body: { endpoint?: unknown; token?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }

  const identifier =
    typeof body.endpoint === 'string'
      ? { endpoint: body.endpoint }
      : typeof body.token === 'string'
        ? { token: body.token }
        : null;
  if (!identifier) {
    throw new BadRequestError('Either endpoint or token must be a string.');
  }

  try {
    await removePushSubscription(auth.uid, identifier);
    return { success: true };
  } catch (err) {
    if (err instanceof PushSubscriptionValidationError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  }
});

export const OPTIONS = optionsHandler;
