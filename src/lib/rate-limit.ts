/**
 * AUDIT.md 3.8 — per-user rate limiting for abuse-prone server actions.
 *
 * Without this, one scripted account can fire millions of follows / likes /
 * reviews / invites — each of which writes a notification — in minutes. That's
 * a notification-spam vector, a Firestore-cost vector, and a way to harass
 * other users. At ~1000 users this is a realistic pre-launch concern.
 *
 * Design: a fixed-window counter per (uid, action), stored in `/rate_limits`
 * and updated inside a transaction so concurrent calls can't both slip past
 * the cap. Generous limits — tuned to never inconvenience a real human, only
 * to stop automation.
 *
 * Fails OPEN: if the limiter itself errors, the call is allowed. A broken
 * limiter must degrade to "no limit", never to "app broken".
 *
 * `/rate_limits` is server-only (see firestore.rules) — clients can't read or
 * tamper with their own counters.
 */

import { getDb } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

export type RateLimitResult = { ok: true } | { ok: false; error: string };

export type RateLimitConfig = { limit: number; windowMs: number };

/**
 * Default limits per action key. Window is 60s unless noted.
 * Sized so a human never hits them but a script does immediately.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  follow:        { limit: 30, windowMs: 60_000 },
  like:          { limit: 60, windowMs: 60_000 },
  review:        { limit: 15, windowMs: 60_000 },
  invite:        { limit: 20, windowMs: 60_000 },
  pushSubscribe: { limit: 10, windowMs: 60_000 },
  report:        { limit: 10, windowMs: 60_000 },
  post:          { limit: 15, windowMs: 60_000 },
  // Phase C — AI film extraction. Each fresh extraction can cost an Apify run +
  // a Gemini call, so cap both a burst AND a daily total per user.
  extraction:      { limit: 5,  windowMs: 60_000 },
  extractionDaily: { limit: 50, windowMs: 24 * 60 * 60_000 },
};

/**
 * Checks (and consumes) one unit of the caller's budget for `action`.
 * Call it AFTER verifyCaller, with the verified uid.
 *
 *   const rl = await checkRateLimit(auth.uid, 'follow');
 *   if (!rl.ok) return { error: rl.error };
 */
export async function checkRateLimit(
  uid: string,
  action: keyof typeof RATE_LIMITS,
  configOverride?: RateLimitConfig,
): Promise<RateLimitResult> {
  const config = configOverride ?? RATE_LIMITS[action];
  if (!config) return { ok: true }; // unknown action → don't block

  const db = getDb();
  const ref = db.collection('rate_limits').doc(`${uid}_${action}`);
  const now = Date.now();

  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : undefined;
      const windowStart: number = typeof data?.windowStart === 'number' ? data.windowStart : 0;
      const count: number = typeof data?.count === 'number' ? data.count : 0;

      if (now - windowStart >= config.windowMs) {
        // Window expired (or first ever call) → start a fresh window.
        tx.set(ref, { windowStart: now, count: 1 });
        return true;
      }
      if (count >= config.limit) {
        return false; // budget exhausted for this window
      }
      tx.update(ref, { count: FieldValue.increment(1) });
      return true;
    });

    return allowed
      ? { ok: true }
      : { ok: false, error: "You're doing that too fast. Please slow down and try again shortly." };
  } catch (err) {
    // Fail open — never let a limiter malfunction take the feature down.
    console.error(`[rateLimit] check failed for ${action}, allowing:`, err);
    return { ok: true };
  }
}
