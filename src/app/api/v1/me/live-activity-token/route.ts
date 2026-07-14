/**
 * `POST /api/v1/me/live-activity-token` — the app registers this device's
 * ActivityKit PUSH-TO-START token (iOS 17.2+), letting the extraction
 * pipeline birth the lock-screen scan tracker without the app ever opening
 * (LIVE-ACTIVITY-PLAN.md). Re-posted on every launch + on rotation — the
 * doc is a lease, keyed by a stable per-install deviceId.
 *
 *   body: { deviceId, token } → { saved: true }
 */

import { apiRoute, optionsHandler, BadRequestError } from '@/lib/api-handler';
import { registerLiveActivityToken } from '@/lib/live-activity-server';
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

  let body: { deviceId?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('Invalid JSON body.');
  }
  return registerLiveActivityToken(auth.uid, body.deviceId, body.token);
});

export const OPTIONS = optionsHandler;
