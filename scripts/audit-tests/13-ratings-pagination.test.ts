/**
 * Phase 2.5 — getUserRatings cursor pagination.
 *
 * Migrated to the /api/v1 route in Phase A PR #9. Server-side helper
 * lives in `src/lib/ratings-server.ts`; route is
 * `GET /api/v1/users/[uid]/ratings?limit=&cursor=`.
 *
 * Pre-fix regression target: single 500-cap call, the tail (everything past
 * 500) silently dropped — Letterboxd importers routinely exceed this.
 * Fix: cursor pagination (last-seen `updatedAt` ISO timestamp) so callers
 * paginate until exhausted. The client cache provider loops until
 * `hasMore === false`.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as ratingsGet } from '@/app/api/v1/users/[uid]/ratings/route';

let alice: TestUser;

before(() => { setupTestEnv(); });

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
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) qs.set('cursor', cursor);
    const res = await callRoute<{ ratings: Array<{ tmdbId: number; updatedAt: Date }>; hasMore: boolean; nextCursor?: string }>(
      ratingsGet, 'GET', {
        params: { uid: alice.uid },
        url: `http://test/api/v1/users/${alice.uid}/ratings?${qs.toString()}`,
      },
    );
    if (res.body.ok !== true) return assert.fail(`expected ok, got ${JSON.stringify(res.body)}`);
    if (res.body.data.ratings.length === 0) break;
    for (const r of res.body.data.ratings) {
      assert.ok(!seen.has(r.tmdbId), `tmdbId ${r.tmdbId} returned twice — cursor advancing incorrectly`);
      seen.add(r.tmdbId);
    }
    if (!res.body.data.hasMore) break;
    if (!res.body.data.nextCursor) break;
    cursor = res.body.data.nextCursor;
  }

  assert.equal(seen.size, TOTAL, `expected all ${TOTAL} ratings; got ${seen.size}`);
});

test('omitting cursor returns the first page only (backward-compatible)', async () => {
  let b = adminDb().batch();
  for (let i = 0; i < 50; i++) {
    b.set(adminDb().collection('ratings').doc(`${alice.uid}_${i}`), {
      userId: alice.uid, tmdbId: i, mediaType: 'movie', movieTitle: `m${i}`, rating: 5,
      createdAt: new Date(Date.now() - i * 1000),
      updatedAt: new Date(Date.now() - i * 1000),
    });
  }
  await b.commit();

  const res = await callRoute<{ ratings: unknown[] }>(ratingsGet, 'GET', {
    params: { uid: alice.uid },
    url: `http://test/api/v1/users/${alice.uid}/ratings?limit=25`,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.ratings.length, 25, 'respects limit when no cursor');
});
