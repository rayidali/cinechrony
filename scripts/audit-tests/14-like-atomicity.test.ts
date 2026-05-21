/**
 * Phase 3.5 — like / unlike atomicity.
 *
 * Pre-fix: get() then a separate update() with increment(1)+arrayUnion.
 * A fast double-tap (or two devices) ran increment twice while arrayUnion
 * deduped likedBy to one entry → `likes` drifted above the real count.
 *
 * Fix: read-check-write in db.runTransaction. This test fires concurrent
 * likes and asserts `likes` always equals likedBy.length.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let likeReview: (idToken: unknown, reviewId: string) => Promise<any>;
let unlikeReview: (idToken: unknown, reviewId: string) => Promise<any>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ likeReview, unlikeReview } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('reviews').doc('r1').set({
    userId: 'someone-else', text: 'great', likes: 0, likedBy: [],
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const review = async () => (await adminDb().collection('reviews').doc('r1').get()).data();

test('concurrent double-like by the SAME user → likes 1, not 2', async () => {
  await Promise.all([
    callActionAs(alice, likeReview, 'r1'),
    callActionAs(alice, likeReview, 'r1'),
  ]);
  const r = await review();
  assert.equal(r?.likes, 1, 'likes did not double-count');
  assert.deepEqual(r?.likedBy, [alice.uid], 'likedBy has exactly one entry');
});

test('likes always equals likedBy.length (two distinct users, concurrent)', async () => {
  await Promise.all([
    callActionAs(alice, likeReview, 'r1'),
    callActionAs(bob, likeReview, 'r1'),
  ]);
  const r = await review();
  assert.equal(r?.likes, 2);
  assert.equal(r?.likes, (r?.likedBy as string[]).length, 'count matches array');
});

test('like then unlike returns to zero', async () => {
  await callActionAs(alice, likeReview, 'r1');
  await callActionAs(alice, unlikeReview, 'r1');
  const r = await review();
  assert.equal(r?.likes, 0);
  assert.deepEqual(r?.likedBy, []);
});

test('concurrent double-unlike → decremented once, not to -1', async () => {
  await callActionAs(alice, likeReview, 'r1');
  await Promise.all([
    callActionAs(alice, unlikeReview, 'r1'),
    callActionAs(alice, unlikeReview, 'r1'),
  ]);
  const r = await review();
  assert.equal(r?.likes, 0, 'never drifts to -1');
  assert.deepEqual(r?.likedBy, []);
});

test('like already-liked / unlike not-liked are rejected', async () => {
  await callActionAs(alice, likeReview, 'r1');
  assert.deepEqual(await callActionAs(alice, likeReview, 'r1'), { error: 'Already liked.' });
  await callActionAs(alice, unlikeReview, 'r1');
  assert.deepEqual(await callActionAs(alice, unlikeReview, 'r1'), { error: 'Not liked yet.' });
});
