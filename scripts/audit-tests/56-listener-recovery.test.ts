/**
 * Real-time listener failure policy (`src/firebase/firestore/listener-recovery.ts`)
 * — the rules that decide whether a Firestore listener blip becomes a scary red
 * banner or stays invisible until it's actually a problem.
 *
 * THE BUG THESE GUARD (2026-07-30). `useCollection` + `useDoc` built a
 * `FirestorePermissionError` for EVERY error code and emitted the global
 * 'permission-error' on the FIRST failure of a streak. Opening the app from
 * Instagram on 5G, the owner got "Action blocked / That didn't go through. If it
 * keeps happening, try refreshing or signing in again." for a one-second network
 * blip — on a screen that simultaneously said "no lists yet" while holding
 * several lists, because a never-loaded listener is indistinguishable from an
 * empty collection unless something tracks the difference.
 *
 * Pure functions, no emulator: this is policy, so it's asserted directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FirestoreError } from 'firebase/firestore';
import {
  LISTENER_REPORT_AFTER_ATTEMPTS,
  describeListenerFailure,
  isListenerStillSettling,
  isPermissionDenial,
  listenerRetryDelayMs,
  nextListenerAttempt,
  shouldReportListenerFailure,
} from '@/firebase/firestore/listener-recovery';
import { FirestorePermissionError } from '@/firebase/errors';

const err = (code: string): FirestoreError =>
  ({ code, message: `simulated ${code}`, name: 'FirebaseError' } as FirestoreError);

// ── Classification: only a real denial is a permission problem ────────────

test('a genuine permission-denied becomes a FirestorePermissionError', () => {
  const e = describeListenerFailure(err('permission-denied'), 'list', 'users/u1/lists');
  assert.ok(e instanceof FirestorePermissionError);
  assert.ok(isPermissionDenial(e), 'and it is the only thing routed to the global toast');
});

test('transient codes stay honest plain errors naming the real cause', () => {
  // These are the codes that actually fired in the field. None of them is a
  // security-rules problem, and none should ever say "try signing in again".
  for (const code of ['unavailable', 'cancelled', 'resource-exhausted', 'unauthenticated', 'failed-precondition', 'internal']) {
    const e = describeListenerFailure(err(code), 'list', 'users/u1/lists');
    assert.ok(!(e instanceof FirestorePermissionError), `${code} must not be a permission error`);
    assert.ok(!isPermissionDenial(e), `${code} must never reach the permission-error channel`);
    assert.match(e.message, new RegExp(code), 'the real code survives into logs + Sentry');
    assert.match(e.message, /users\/u1\/lists/, 'and so does the path');
  }
});

test('the classifier reports the operation it was given', () => {
  assert.match(describeListenerFailure(err('unavailable'), 'get', 'users/u1').message, /get/);
  assert.match(describeListenerFailure(err('unavailable'), 'list', 'users/u1/lists').message, /list/);
});

// ── Grace period: no crying wolf on the first blip ────────────────────────

test('nothing is reported until the failure stops being plausibly transient', () => {
  let attempt = 0;
  const reported: number[] = [];
  for (let i = 0; i < 10; i++) {
    attempt = nextListenerAttempt(attempt);
    if (shouldReportListenerFailure(attempt)) reported.push(attempt);
  }
  assert.deepEqual(reported, [LISTENER_REPORT_AFTER_ATTEMPTS],
    'exactly once per streak, and not on attempt 1 — the old behaviour');
  assert.ok(LISTENER_REPORT_AFTER_ATTEMPTS >= 3, 'a real grace window, not a token one');
});

test('the grace window covers a multi-second outage before the user sees anything', () => {
  let total = 0;
  for (let a = 1; a < LISTENER_REPORT_AFTER_ATTEMPTS; a++) total += listenerRetryDelayMs(a);
  assert.ok(total >= 8_000,
    `silent retrying must span a real reconnect (got ${total}ms)`);
});

test('a recovered listener resets, so a later blip gets a fresh grace window', () => {
  let attempt = nextListenerAttempt(nextListenerAttempt(0));
  assert.equal(shouldReportListenerFailure(attempt), false);
  attempt = 0; // a good snapshot arrived
  attempt = nextListenerAttempt(attempt);
  assert.equal(attempt, 1, 'back to the start');
  assert.equal(shouldReportListenerFailure(attempt), false, 'and quiet again');
});

// ── Backoff shape ─────────────────────────────────────────────────────────

test('backoff climbs and plateaus instead of hammering or overflowing', () => {
  assert.equal(listenerRetryDelayMs(1), 1_500);
  assert.equal(listenerRetryDelayMs(2), 3_000);
  assert.equal(listenerRetryDelayMs(3), 6_000);
  assert.equal(listenerRetryDelayMs(6), 30_000, 'capped');
  assert.equal(nextListenerAttempt(6), 6, 'the counter plateaus so 2**n cannot run away');
  assert.equal(listenerRetryDelayMs(99), 30_000);
  assert.ok(listenerRetryDelayMs(0) >= 1_500, 'a zero/garbage attempt still waits');
});

// ── "Never loaded" is not "empty" ─────────────────────────────────────────

test('a listener that never returned a snapshot keeps reporting as loading', () => {
  // This is what stops a screen rendering "no lists yet" at someone who has
  // lists. Held only while genuinely unresolved, so it cannot spin forever.
  assert.equal(isListenerStillSettling(false, 1), true);
  assert.equal(isListenerStillSettling(false, LISTENER_REPORT_AFTER_ATTEMPTS - 1), true);
  assert.equal(isListenerStillSettling(false, LISTENER_REPORT_AFTER_ATTEMPTS), false,
    'grace exhausted → stop pretending to load and surface the real state');
});

test('once data has ever loaded, a failure never re-enters the loading state', () => {
  // Stale data on screen beats a skeleton wiping out a populated list.
  for (let a = 1; a <= 6; a++) {
    assert.equal(isListenerStillSettling(true, a), false);
  }
});
