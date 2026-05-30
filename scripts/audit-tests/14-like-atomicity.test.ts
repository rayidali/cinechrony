/**
 * Phase 3.5 — like / unlike atomicity.
 *
 * Migrated to /api/v1 routes in Phase A PR #8. The transactional invariants
 * the legacy actions enforced are preserved in `src/lib/reviews-server.ts`
 * and exercised end-to-end through the route handlers here.
 *
 * Pre-fix regression target: get() then a separate update() with
 * increment(1)+arrayUnion. A fast double-tap (or two devices) ran
 * increment twice while arrayUnion deduped likedBy to one entry →
 * `likes` drifted above the real count. Fix: read-check-write in
 * db.runTransaction.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as likePost, DELETE as unlikeDelete } from '@/app/api/v1/reviews/[id]/like/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice',
  });
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob',
  });
  await adminDb().collection('reviews').doc('r1').set({
    userId: 'someone-else', text: 'great', likes: 0, likedBy: [],
    tmdbId: 1, mediaType: 'movie', movieTitle: 'X',
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const review = async () => (await adminDb().collection('reviews').doc('r1').get()).data();

async function like(user: TestUser) {
  return callRoute(likePost, 'POST', {
    token: await user.getIdToken(), params: { id: 'r1' },
  });
}
async function unlike(user: TestUser) {
  return callRoute(unlikeDelete, 'DELETE', {
    token: await user.getIdToken(), params: { id: 'r1' },
  });
}

test('concurrent double-like by the SAME user → likes 1, not 2', async () => {
  await Promise.all([like(alice), like(alice)]);
  const r = await review();
  assert.equal(r?.likes, 1, 'likes did not double-count');
  assert.deepEqual(r?.likedBy, [alice.uid], 'likedBy has exactly one entry');
});

test('likes always equals likedBy.length (two distinct users, concurrent)', async () => {
  await Promise.all([like(alice), like(bob)]);
  const r = await review();
  assert.equal(r?.likes, 2);
  assert.equal(r?.likes, (r?.likedBy as string[]).length, 'count matches array');
});

test('like then unlike returns to zero', async () => {
  await like(alice);
  await unlike(alice);
  const r = await review();
  assert.equal(r?.likes, 0);
  assert.deepEqual(r?.likedBy, []);
});

test('concurrent double-unlike → decremented once, not to -1', async () => {
  await like(alice);
  await Promise.all([unlike(alice), unlike(alice)]);
  const r = await review();
  assert.equal(r?.likes, 0, 'never drifts to -1');
  assert.deepEqual(r?.likedBy, []);
});

test('like already-liked / unlike not-liked are rejected with 409', async () => {
  await like(alice);
  const dupeLike = await like(alice);
  assert.equal(dupeLike.status, 409, 'AlreadyLikedError → 409');

  await unlike(alice);
  const ghostUnlike = await unlike(alice);
  assert.equal(ghostUnlike.status, 409, 'NotLikedError → 409');
});
