'use client';

import type { FirestoreError } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * Shared failure policy for the real-time listener hooks (`useCollection` +
 * `useDoc`). Lives in one place so the two can never drift — they had already
 * drifted from the WRITE path, which is how the bug below survived.
 *
 * A Firestore `onSnapshot` listener is permanently DEAD once its error callback
 * fires, and plenty of ordinary conditions trip it:
 *   - a cold start where the listener attaches before the auth credential has
 *     reached the Firestore client (`permission-denied`, transiently),
 *   - an expired ID token (~1h),
 *   - a dropped long-poll after the native app sat backgrounded,
 *   - any network handoff — walking out of wifi, a 5G blip.
 * Every one of those recovers on its own within seconds. So the hooks retry with
 * capped backoff, keep last-known data, and say NOTHING to the user meanwhile.
 *
 * WHY THE QUIET MATTERS (2026-07-30). Both hooks used to build a
 * `FirestorePermissionError` for *any* error code and emit the global
 * 'permission-error' on the FIRST failure of a streak. That put a red
 * "Action blocked / That didn't go through. If it keeps happening, try
 * refreshing or signing in again." toast on screen for a one-second network
 * blip. The owner hit it opening the app from Instagram over 5G — on a screen
 * that simultaneously rendered "no lists yet", because a never-loaded listener
 * looked identical to a genuinely empty collection.
 *
 * Two symptoms, one mistake: reporting "not ready yet" as "you are broken". The
 * write path already got this right (`non-blocking-updates.tsx` reports only a
 * genuine `permission-denied`, everything else is a console diagnostic). This
 * module brings the read path in line and adds the missing grace period.
 */

/**
 * Consecutive failures a listener absorbs silently before the user is told
 * anything. Reporting happens ON this attempt, so the silent window is the sum
 * of the delays before it: 1.5s + 3s + 6s ≈ **10.5s** of quiet retrying. That
 * comfortably covers every transient cause listed above; a failure still alive
 * after it is genuinely persistent, which is also exactly what's worth a Sentry
 * event and a word to the user.
 *
 * Do not lower this to "feel responsive" — the cost of being early is a red
 * "try signing in again" banner during a hiccup, which is strictly worse than a
 * few more seconds of skeleton. (3 was tried: only 4.5s, too tight for a cold
 * start on a slow connection.)
 *
 * Deliberately applies to `permission-denied` too: on a cold start a rules
 * denial is usually just "the credential hasn't landed yet", so treating it as
 * instantly fatal is the same cry-wolf error in a different costume.
 */
export const LISTENER_REPORT_AFTER_ATTEMPTS = 4;

/** Capped exponential backoff: 1.5s, 3, 6, 12, 24, 30, 30… */
export function listenerRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_500 * 2 ** (Math.max(1, attempt) - 1));
}

/** Attempt counter is capped so the backoff plateaus instead of overflowing. */
export function nextListenerAttempt(current: number): number {
  return Math.min(current + 1, 6);
}

/**
 * True exactly once per failure streak — on the attempt where the failure stops
 * being plausibly transient. `=== ` and not `>=` so a long outage toasts once,
 * not on every subsequent retry.
 */
export function shouldReportListenerFailure(attempt: number): boolean {
  return attempt === LISTENER_REPORT_AFTER_ATTEMPTS;
}

/**
 * True while a listener that has NEVER produced a snapshot is still inside its
 * grace period. Callers keep `isLoading` true here so a screen renders its
 * skeleton rather than an empty state it cannot actually vouch for.
 */
export function isListenerStillSettling(hasEverLoaded: boolean, attempt: number): boolean {
  return !hasEverLoaded && attempt < LISTENER_REPORT_AFTER_ATTEMPTS;
}

/**
 * Classify a listener failure. A genuine `permission-denied` becomes the rich
 * `FirestorePermissionError` (it carries the rule-debugging payload and the
 * "Action blocked" copy is accurate). Anything else stays an honest plain Error
 * naming its real Firestore code, so console output and Sentry stop attributing
 * network blips and quota exhaustion to the security rules.
 */
export function describeListenerFailure(
  err: FirestoreError,
  operation: 'get' | 'list',
  path: string,
): FirestorePermissionError | Error {
  if (err.code === 'permission-denied') {
    return new FirestorePermissionError({ operation, path });
  }
  const wrapped = new Error(
    `Firestore ${operation} on "${path}" failed: ${err.code || 'unknown'} — ${err.message}`,
  );
  wrapped.name = 'FirestoreListenerError';
  return wrapped;
}

/** Only a real rules denial belongs on the global 'permission-error' channel. */
export function isPermissionDenial(error: unknown): boolean {
  return error instanceof FirestorePermissionError;
}
