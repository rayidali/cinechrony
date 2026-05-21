/**
 * Phase 2.5 — getUserRatings cursor pagination.
 *
 * Pre-fix: single 500-cap call, the tail (everything past 500) silently
 * dropped — Letterboxd importers routinely exceed this.
 * Fix: added optional `cursor` (last-seen updatedAt ISO) param so callers
 * can paginate until exhausted. The client cache provider loops until a
 * short page is returned.
 *
 * This test verifies the server-side cursor contract: seeding > pageSize
 * ratings and walking via cursor collects every rating exactly once.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let getUserRatings: (userId: string, limit?: number, cursor?: string) => Promise<any>;
let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ getUserRatings } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('cursor pagination collects ALL ratings past the page cap, exactly once', async () => {
  // Seed 1200 ratings — past the 500 single-call cap.
  const TOTAL = 1200;
  const PAGE = 500;
  // Use distinct, monotonically-decreasing timestamps so updatedAt-desc
  // ordering is deterministic and the cursor never ties.
  const start = Date.now();
  let seedBatch = adminDb().batch();
  let count = 0;
  for (let i = 0; i < TOTAL; i++) {
    const ts = new Date(start - i * 1000); // older as i grows
    seedBatch.set(adminDb().collection('ratings').doc(`${alice.uid}_${i}`), {
      userId: alice.uid, tmdbId: i, mediaType: 'movie',
      movieTitle: `M${i}`, rating: 5,
      createdAt: ts, updatedAt: ts,
    });
    count++;
    if (count >= 450) { await seedBatch.commit(); seedBatch = adminDb().batch(); count = 0; }
  }
  if (count > 0) await seedBatch.commit();

  // Walk via cursor.
  const seen = new Set<number>();
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await getUserRatings(alice.uid, PAGE, cursor);
    assert.ok(Array.isArray(res.ratings), JSON.stringify(res));
    if (res.ratings.length === 0) break;
    for (const r of res.ratings) {
      assert.ok(!seen.has(r.tmdbId), `tmdbId ${r.tmdbId} returned twice — cursor advancing incorrectly`);
      seen.add(r.tmdbId);
    }
    if (res.ratings.length < PAGE) break;
    cursor = (res.ratings[res.ratings.length - 1].updatedAt as Date).toISOString();
  }

  assert.equal(seen.size, TOTAL, `expected all ${TOTAL} ratings; got ${seen.size}`);
});

test('omitting cursor returns the first page only (backward-compatible)', async () => {
  // Smaller seed — no need for thousands here.
  let b = adminDb().batch();
  for (let i = 0; i < 50; i++) {
    b.set(adminDb().collection('ratings').doc(`${alice.uid}_${i}`), {
      userId: alice.uid, tmdbId: i, mediaType: 'movie', movieTitle: `m${i}`, rating: 5,
      createdAt: new Date(Date.now() - i * 1000),
      updatedAt: new Date(Date.now() - i * 1000),
    });
  }
  await b.commit();

  const res = await getUserRatings(alice.uid, 25);
  assert.equal(res.ratings.length, 25, 'respects limit when no cursor');
});
