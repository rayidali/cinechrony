/**
 * Phase 1 — content mutations regression test (createReview, createOrUpdateRating).
 *
 * Pre-fix: the author/owner was a client-supplied `userId` first arg, so an
 * attacker could post reviews / ratings AS another user (impersonation +
 * reputation abuse). Post-fix: author is the verified token uid.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createReviewPost } from '@/app/api/v1/reviews/route';
import { POST as createRatingPost } from '@/app/api/v1/ratings/route';

let alice: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', displayName: 'Alice',
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('POST /reviews: review is attributed to the TOKEN owner', async () => {
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(createReviewPost, 'POST', {
    token: aliceToken,
    body: { tmdbId: 603, mediaType: 'movie', movieTitle: 'The Matrix', text: 'peak cinema' },
  });
  assert.equal(res.status, 200, 'review created');

  const reviews = await adminDb().collection('reviews').where('tmdbId', '==', 603).get();
  assert.equal(reviews.size, 1);
  assert.equal(reviews.docs[0].data().userId, alice.uid, 'authored by verified caller');
});

test('POST /reviews: forged token cannot post a review as someone', async () => {
  const res = await callRoute(createReviewPost, 'POST', {
    token: 'forged',
    body: { tmdbId: 603, mediaType: 'movie', movieTitle: 'X', text: 'spam' },
  });
  assert.equal(res.status, 401);
  const reviews = await adminDb().collection('reviews').get();
  assert.equal(reviews.size, 0, 'no review written');
});

test('POST /ratings: rating keyed to verified uid; forged rejected', async () => {
  const aliceToken = await alice.getIdToken();
  const ok = await callRoute(createRatingPost, 'POST', {
    token: aliceToken,
    body: { tmdbId: 603, mediaType: 'movie', movieTitle: 'The Matrix', rating: 9 },
  });
  assert.equal(ok.status, 200);
  const rating = await adminDb().collection('ratings').doc(`${alice.uid}_603`).get();
  assert.equal(rating.exists, true, 'rating doc id is {verifiedUid}_{tmdbId}');
  assert.equal(rating.data()?.rating, 9);

  const bad = await callRoute(createRatingPost, 'POST', {
    token: 'forged',
    body: { tmdbId: 603, mediaType: 'movie', movieTitle: 'X', rating: 1 },
  });
  assert.equal(bad.status, 401);
});
