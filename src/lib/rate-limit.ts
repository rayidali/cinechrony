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

export type RateLimitResult = { ok: true } | { ok: false; error: string; retryAfterMs: number };

export type RateLimitConfig = {
  limit: number;
  windowMs: number;
  /** What was capped, in the user's language ('movie nights', 'scans'). Used
   *  ONLY by the long-window copy below, which names the thing instead of
   *  vaguely telling someone to slow down. Omit for the per-minute buckets —
   *  they use the generic burst copy, where naming the action adds nothing. */
  noun?: string;
};

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
  // Letterboxd username import — each scrape/start spins a BILLABLE Apify
  // residential-proxy run (an uncapped one once ran an hour at ~$3.70). Tight.
  import:        { limit: 4,  windowMs: 60 * 60_000, noun: 'library imports' },
  importDaily:   { limit: 20, windowMs: 24 * 60 * 60_000, noun: 'library imports' },
  // Media writes to R2 (avatar / cover / post upload URL) — storage + egress $.
  upload:        { limit: 40, windowMs: 60 * 60_000, noun: 'uploads' },
  // Rating / watch writes — each emits a denormalized activity + notifications.
  rate:          { limit: 60, windowMs: 60_000 },
  // Phase C — AI film extraction. Each fresh extraction can cost an Apify run +
  // a Gemini call, so cap both a burst AND a daily total per user.
  extraction:      { limit: 5,  windowMs: 60_000 },
  extractionDaily: { limit: 50, windowMs: 24 * 60 * 60_000, noun: 'scans' },
  // Movie Night (MOVIE-NIGHT-PLAN.md). Creating one writes a night doc plus a
  // notification + push per invitee (max 9) — the same abuse surface as
  // `invite` (20/min) and `post` (15/min), and NOT a billable one like an
  // extraction. It was originally a flat 10/DAY, sized to how often people
  // plan nights rather than to that surface, which had it backwards twice
  // over: it let a script spend the whole budget in ten seconds AND locked a
  // real host out for the next 24 hours. Now burst + daily, the shape every
  // other multi-write action here uses. Invitees must already be a list
  // member or someone the host follows, so the reachable blast radius is
  // people who already opted into hearing from them.
  movieNightCreate:      { limit: 6,  windowMs: 60_000 },
  movieNightCreateDaily: { limit: 40, windowMs: 24 * 60 * 60_000, noun: 'movie nights' },
  movieNightRsvp:        { limit: 20, windowMs: 60_000 },
};

// ─── Honest refusal copy ───────────────────────────────────────────────────
//
// Every bucket used to share ONE message: "You're doing that too fast. Please
// slow down and try again shortly." That copy is shaped for a 60-second
// window, and it's a lie on the daily ones — "shortly" can mean twenty hours,
// and "slow down" implies the user did something wrong when they simply spent
// a real budget. A refusal that misdescribes itself is the same class of
// problem as a test gate that reports "blocked" as "broken": the message is
// the only thing the user has to act on, so it has to be true.
//
// Two shapes, split on window length: burst buckets keep the (now accurate)
// "give it a minute", and anything an hour or longer names what was capped
// and says when it actually comes back.

const LONG_WINDOW_MS = 60 * 60_000;

/** '6 hours' / '35 minutes' / 'a minute' — always rounds UP, so the stated
 *  wait is never shorter than the real one (a user who retries exactly when
 *  we told them to must not be refused a second time). */
function formatDuration(ms: number): string {
  if (ms <= 60_000) return 'a minute';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  if (hours === 1) return 'an hour';
  return `${hours} hours`;
}

/** 'a day' / 'an hour' / '6 hours' — the budget's period, for the long copy. */
function formatWindow(ms: number): string {
  if (ms >= 24 * 60 * 60_000) return 'a day';
  return formatDuration(ms);
}

function limitMessage(config: RateLimitConfig, retryAfterMs: number): string {
  if (config.windowMs < LONG_WINDOW_MS) {
    return `you're going a bit fast. give it ${formatDuration(retryAfterMs)} and try again.`;
  }
  const noun = config.noun ?? 'of those';
  return `that's ${config.limit} ${noun} in ${formatWindow(config.windowMs)}. try again in ${formatDuration(retryAfterMs)}.`;
}

// ─── In-memory per-IP limiter (unauthenticated routes) ─────────────────────
//
// The Firestore limiter above needs a verified uid, so it can't cover the
// public routes (auth/login, forgot-password, search, share/*, TMDB/OMDB
// proxies) — exactly the ones an anonymous script can loop to drain the free
// quota or brute-force credentials. This is a zero-cost, zero-latency
// per-instance fixed-window counter in front of them. Per-instance means an
// attacker spread over N Vercel instances gets N× the limit — still bounded,
// still free; the Vercel WAF (owner-configured) is the real distributed
// backstop. We keep it purely in-memory: a limiter that itself hit Firestore
// on every anonymous request would be its own DoS amplifier.

type IpWindow = { count: number; resetAt: number };
const ipBuckets = new Map<string, IpWindow>();
const IP_BUCKETS_MAX = 20_000; // hard cap so a spray of distinct IPs can't grow the map unbounded

/**
 * Consume one unit of `ip`'s budget for `action`. Returns true if allowed.
 * Fails OPEN on a missing IP (can't fairly limit an unknown caller) — the WAF
 * covers that case.
 */
export function checkIpRateLimit(
  ip: string | null,
  action: string,
  config: RateLimitConfig,
): boolean {
  if (!ip) return true;
  const now = Date.now();
  const key = `${ip}|${action}`;
  const w = ipBuckets.get(key);
  if (!w || now >= w.resetAt) {
    // Opportunistic prune when the map is large — sweep expired entries so a
    // long-lived instance doesn't accumulate dead windows.
    if (ipBuckets.size > IP_BUCKETS_MAX) {
      for (const [k, v] of ipBuckets) if (now >= v.resetAt) ipBuckets.delete(k);
      if (ipBuckets.size > IP_BUCKETS_MAX) ipBuckets.clear(); // last resort
    }
    ipBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }
  if (w.count >= config.limit) return false;
  w.count++;
  return true;
}

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
    // On refusal the transaction reports how much of the window is left, so
    // the message can name a real wait instead of a vague "shortly". This is
    // a FIXED window: it opened on the first call, so the budget returns all
    // at once when it expires, not gradually.
    const outcome = await db.runTransaction<{ allowed: true } | { allowed: false; retryAfterMs: number }>(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : undefined;
      const windowStart: number = typeof data?.windowStart === 'number' ? data.windowStart : 0;
      const count: number = typeof data?.count === 'number' ? data.count : 0;

      if (now - windowStart >= config.windowMs) {
        // Window expired (or first ever call) → start a fresh window.
        tx.set(ref, { windowStart: now, count: 1 });
        return { allowed: true };
      }
      if (count >= config.limit) {
        // Budget exhausted. `max(0, …)` guards a clock skew that would
        // otherwise produce a negative (and therefore nonsense) wait.
        return { allowed: false, retryAfterMs: Math.max(0, windowStart + config.windowMs - now) };
      }
      tx.update(ref, { count: FieldValue.increment(1) });
      return { allowed: true };
    });

    return outcome.allowed
      ? { ok: true }
      : { ok: false, error: limitMessage(config, outcome.retryAfterMs), retryAfterMs: outcome.retryAfterMs };
  } catch (err) {
    // Fail open — never let a limiter malfunction take the feature down.
    console.error(`[rateLimit] check failed for ${action}, allowing:`, err);
    return { ok: true };
  }
}
