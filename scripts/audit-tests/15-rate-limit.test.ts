/**
 * Phase 3.8 — per-user rate limiting.
 *
 * Without this, one scripted account fires unlimited follows / likes /
 * reviews / invites — each writing a notification. checkRateLimit enforces a
 * fixed-window per-(uid, action) cap inside a transaction so concurrent calls
 * can't both slip past.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let checkRateLimit: (uid: string, action: any, cfg?: { limit: number; windowMs: number; noun?: string }) => Promise<any>;
let RATE_LIMITS: Record<string, { limit: number; windowMs: number; noun?: string }>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ checkRateLimit, RATE_LIMITS } = await import('@/lib/rate-limit'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

const cfg = { limit: 3, windowMs: 60_000 };

test('allows up to the limit, then rejects', async () => {
  for (let i = 1; i <= 3; i++) {
    const r = await checkRateLimit(alice.uid, 'follow', cfg);
    assert.equal(r.ok, true, `call ${i} should be allowed`);
  }
  const r4 = await checkRateLimit(alice.uid, 'follow', cfg);
  assert.equal(r4.ok, false, '4th call over the limit is rejected');
  assert.match(r4.error, /going a bit fast/i);
});

// ── Honest refusal copy ───────────────────────────────────────────────────
//
// The message is the only thing a refused user can act on, so it has to be
// true. Every bucket used to share one 60-second-shaped line ("slow down and
// try again shortly") — on a 24h bucket that reads as "wait a moment" when
// the real answer is "wait twenty hours". These lock the two shapes apart.

test('a burst bucket says "a bit fast" and reports a sub-minute retry', async () => {
  for (let i = 0; i < 3; i++) await checkRateLimit(alice.uid, 'follow', cfg);
  const r = await checkRateLimit(alice.uid, 'follow', cfg);

  assert.equal(r.ok, false);
  assert.match(r.error, /going a bit fast/i, 'burst copy');
  assert.doesNotMatch(r.error, /hours/i, 'a 60s window must never mention hours');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 60_000, `retryAfterMs within the window, got ${r.retryAfterMs}`);
});

test('a daily bucket names what was capped and states the REAL wait', async () => {
  // The shipped movieNightCreate shape (10/day) at a test-sized limit — the
  // 24h window is what selects the long copy, so it stays real.
  const daily = { limit: 2, windowMs: 24 * 60 * 60_000, noun: 'movie nights' };
  for (let i = 0; i < 2; i++) await checkRateLimit(alice.uid, 'movieNightCreate', daily);
  const r = await checkRateLimit(alice.uid, 'movieNightCreate', daily);

  assert.equal(r.ok, false);
  assert.match(r.error, /2 movie nights in a day/i, 'names the budget it spent');
  assert.match(r.error, /try again in \d+ hours/i, 'states a real wait, not "shortly"');
  assert.doesNotMatch(r.error, /shortly/i, '"shortly" is a lie on a 24h window');
  assert.ok(
    r.retryAfterMs > 23 * 60 * 60_000,
    `a freshly-exhausted daily budget has ~24h left, got ${r.retryAfterMs}ms`,
  );
});

test('every long-window bucket ships a noun (else the copy says "of those")', () => {
  const LONG_MS = 60 * 60_000;
  const missing = Object.entries(RATE_LIMITS)
    .filter(([, c]) => c.windowMs >= LONG_MS && !c.noun)
    .map(([k]) => k);
  assert.deepEqual(missing, [], `long-window buckets without a noun: ${missing.join(', ')}`);
});

test('copy is brand voice: lowercase start, no dashes, no emoji', async () => {
  for (let i = 0; i < 3; i++) await checkRateLimit(alice.uid, 'follow', cfg);
  const burst = (await checkRateLimit(alice.uid, 'follow', cfg)).error;

  const daily = { limit: 1, windowMs: 24 * 60 * 60_000, noun: 'scans' };
  await checkRateLimit(bob.uid, 'extractionDaily', daily);
  const long = (await checkRateLimit(bob.uid, 'extractionDaily', daily)).error;

  for (const msg of [burst, long]) {
    assert.match(msg, /^[a-z]/, `starts lowercase: ${msg}`);
    assert.doesNotMatch(msg, /[—–]/, `no em/en dashes: ${msg}`);
    assert.doesNotMatch(msg, /\p{Extended_Pictographic}/u, `no emoji: ${msg}`);
  }
});

test('concurrent burst past the limit still caps total allowed at `limit`', async () => {
  // Fire 10 at once; at most 3 may be allowed.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => checkRateLimit(alice.uid, 'like', cfg)),
  );
  const allowed = results.filter((r) => r.ok).length;
  assert.equal(allowed, 3, `exactly 3 allowed under contention, got ${allowed}`);
});

test('window reset: an expired window starts a fresh budget', async () => {
  for (let i = 0; i < 3; i++) await checkRateLimit(alice.uid, 'follow', cfg);
  assert.equal((await checkRateLimit(alice.uid, 'follow', cfg)).ok, false, 'exhausted');

  // Simulate the window having started over a minute ago.
  await adminDb().collection('rate_limits').doc(`${alice.uid}_follow`)
    .update({ windowStart: Date.now() - 61_000 });

  assert.equal((await checkRateLimit(alice.uid, 'follow', cfg)).ok, true, 'fresh window allows again');
});

test('budgets are independent per (uid, action)', async () => {
  // Exhaust alice/follow.
  for (let i = 0; i < 3; i++) await checkRateLimit(alice.uid, 'follow', cfg);
  assert.equal((await checkRateLimit(alice.uid, 'follow', cfg)).ok, false);

  // A different action for the same user is unaffected.
  assert.equal((await checkRateLimit(alice.uid, 'like', cfg)).ok, true, 'different action = different budget');
  // A different user is unaffected.
  assert.equal((await checkRateLimit(bob.uid, 'follow', cfg)).ok, true, 'different user = different budget');
});
