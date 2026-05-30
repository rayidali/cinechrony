/**
 * Phase 1 batch rollout regression test.
 *
 * The batch migrated ~13 mutations with the IDENTICAL mechanical pattern as the
 * updateBio pilot (param → idToken, derive uid from verifyCaller). Rather than
 * 13 near-duplicate tests, this covers two representatives that exercise the two
 * shapes the batch uses:
 *   - followUser: actor identity DERIVED from the token (no actor param at all)
 *   - likeReview: token verified, forged token rejected
 * If anyone reintroduces a trusted client-supplied actor id, these fail.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as followPost } from '@/app/api/v1/users/[uid]/follow/route';
import { POST as likePost } from '@/app/api/v1/reviews/[id]/like/route';

let alice: TestUser;
let bob: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('users').doc(alice.uid).set({ uid: alice.uid, username: 'alice', followingCount: 0, followersCount: 0 });
  await adminDb().collection('users').doc(bob.uid).set({ uid: bob.uid, username: 'bob', followingCount: 0, followersCount: 0 });
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('POST /users/[uid]/follow: actor is the TOKEN owner, not a forgeable param', async () => {
  // Ensure target exists (the route checks).
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob', followersCount: 0, followingCount: 0,
  });
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', followersCount: 0, followingCount: 0,
  });
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 200);

  const aliceFollowing = await adminDb()
    .collection('users').doc(alice.uid).collection('following').doc(bob.uid).get();
  assert.equal(aliceFollowing.exists, true, 'alice now follows bob');

  const bobFollowers = await adminDb()
    .collection('users').doc(bob.uid).collection('followers').doc(alice.uid).get();
  assert.equal(bobFollowers.exists, true, 'bob has alice as a follower');
});

test('POST /users/[uid]/follow: forged token cannot create a follow as someone else', async () => {
  const res = await callRoute(followPost, 'POST', {
    token: 'forged', params: { uid: bob.uid },
  });
  assert.equal(res.status, 401);

  const snap = await adminDb().collection('users').doc(bob.uid).collection('followers').get();
  assert.equal(snap.size, 0, 'no follow relationship was created');
});

test('POST /reviews/[id]/like: valid token likes once; forged token rejected', async () => {
  await adminDb().collection('reviews').doc('r1').set({
    userId: bob.uid, text: 'great film', likes: 0, likedBy: [], tmdbId: 1, mediaType: 'movie',
  });
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice',
  }, { merge: true });

  const aliceToken = await alice.getIdToken();
  const ok = await callRoute(likePost, 'POST', { token: aliceToken, params: { id: 'r1' } });
  assert.equal(ok.status, 200, 'valid like succeeded');
  const liked = await adminDb().collection('reviews').doc('r1').get();
  assert.deepEqual(liked.data()?.likedBy, [alice.uid], 'liked by the token owner');

  const bad = await callRoute(likePost, 'POST', { token: '', params: { id: 'r1' } });
  assert.equal(bad.status, 401);
});
