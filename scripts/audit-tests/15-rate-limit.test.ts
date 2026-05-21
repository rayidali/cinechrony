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

let checkRateLimit: (uid: string, action: any, cfg?: { limit: number; windowMs: number }) => Promise<any>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ checkRateLimit } = await import('@/lib/rate-limit'));
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
  assert.match(r4.error, /too fast/i);
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
