/**
 * Phase A.3 PR #7 — follows-namespace endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/users/[uid]/follow      followUser (auth + rate-limited)
 *   - DELETE /api/v1/users/[uid]/follow      unfollowUser (idempotent)
 *   - GET    /api/v1/users/[uid]/followers   public list
 *   - GET    /api/v1/users/[uid]/following   public list
 *
 * AUDIT regression coverage:
 *   - 3.8 (follow segment) — `checkRateLimit(uid, 'follow')` gates POST.
 *     Not tripped under default test concurrency; presence is verified
 *     by inspection.
 *   - Latent count-drift bug (parallel to 2.2 movieCount): unfollowing
 *     a non-follower used to decrement followingCount → negative drift.
 *     The route is now transactional + idempotent.
 *   - LAUNCH.md 0.5.5 — blocked-in-either-direction follow attempts → 403.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as followPost, DELETE as followDelete }
  from '@/app/api/v1/users/[uid]/follow/route';
import { GET as followersGet }
  from '@/app/api/v1/users/[uid]/followers/route';
import { GET as followingGet }
  from '@/app/api/v1/users/[uid]/following/route';

let alice: TestUser, bob: TestUser, carol: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', displayName: 'Alice',
    followersCount: 0, followingCount: 0,
  });
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob', displayName: 'Bob',
    followersCount: 0, followingCount: 0,
  });
  await adminDb().collection('users').doc(carol.uid).set({
    uid: carol.uid, username: 'carol', displayName: 'Carol',
    followersCount: 0, followingCount: 0,
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const userDoc = (uid: string) => adminDb().collection('users').doc(uid);
const followingDoc = (followerUid: string, targetUid: string) =>
  userDoc(followerUid).collection('following').doc(targetUid);
const followerDoc = (targetUid: string, followerUid: string) =>
  userDoc(targetUid).collection('followers').doc(followerUid);

// ─── POST /follow ────────────────────────────────────────────────────────

test('POST /follow: unauth → 401', async () => {
  const res = await callRoute(followPost, 'POST', {
    params: { uid: bob.uid },
  });
  assert.equal(res.status, 401);
});

test('POST /follow: self-follow → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: alice.uid },
  });
  assert.equal(res.status, 400);
});

test('POST /follow: target user not found → 404', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: 'nonexistent-user-uid' },
  });
  assert.equal(res.status, 404);
});

test('POST /follow: happy path creates both edges + increments both counts', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 200);

  // Symmetric edges
  const followingSnap = await followingDoc(alice.uid, bob.uid).get();
  assert.equal(followingSnap.exists, true);
  const followerSnap = await followerDoc(bob.uid, alice.uid).get();
  assert.equal(followerSnap.exists, true);

  // Counts
  const aliceData = (await userDoc(alice.uid).get()).data();
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(aliceData?.followingCount, 1);
  assert.equal(bobData?.followersCount, 1);
});

test('POST /follow: already-following → 409', async () => {
  const token = await alice.getIdToken();
  await callRoute(followPost, 'POST', { token, params: { uid: bob.uid } });

  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 409);
  // Counts unchanged from the first follow.
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(bobData?.followersCount, 1, 'no double-increment');
});

test('POST /follow: blocked user → 403 (LAUNCH 0.5.5)', async () => {
  // Bob blocks Alice.
  await adminDb().collection('blocks').doc(`${bob.uid}_${alice.uid}`).set({
    blockerId: bob.uid, blockedId: alice.uid,
  });
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 403);

  // Counts/edges untouched.
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(bobData?.followersCount, 0);
  assert.equal((await followingDoc(alice.uid, bob.uid).get()).exists, false);
});

test('POST /follow: blocked-the-other-way → 403 (block is symmetric)', async () => {
  // Alice blocks Bob.
  await adminDb().collection('blocks').doc(`${alice.uid}_${bob.uid}`).set({
    blockerId: alice.uid, blockedId: bob.uid,
  });
  const token = await alice.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 403);
});

test('POST /follow: concurrent double-follow lands one edge only (AUDIT 2.2-class race)', async () => {
  const token = await alice.getIdToken();
  // Two simultaneous follow attempts. Transactional helper collapses to
  // one successful follow + one ConflictError; the count must not
  // double-increment.
  const results = await Promise.allSettled([
    callRoute(followPost, 'POST', { token, params: { uid: bob.uid } }),
    callRoute(followPost, 'POST', { token, params: { uid: bob.uid } }),
  ]);
  // Both calls return a Response; one is 200, the other is 409.
  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort();
  assert.deepEqual(statuses, [200, 409], 'one success, one already-following');
  // Counts honored.
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(bobData?.followersCount, 1);
});

// ─── DELETE /follow ──────────────────────────────────────────────────────

test('DELETE /follow: unauth → 401', async () => {
  const res = await callRoute(followDelete, 'DELETE', {
    params: { uid: bob.uid },
  });
  assert.equal(res.status, 401);
});

test('DELETE /follow: existing follow drops edge + decrements both counts', async () => {
  const token = await alice.getIdToken();
  await callRoute(followPost, 'POST', { token, params: { uid: bob.uid } });

  const res = await callRoute<{ unfollowed: boolean }>(followDelete, 'DELETE', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.unfollowed, true);

  const followingSnap = await followingDoc(alice.uid, bob.uid).get();
  assert.equal(followingSnap.exists, false);
  const followerSnap = await followerDoc(bob.uid, alice.uid).get();
  assert.equal(followerSnap.exists, false);

  const aliceData = (await userDoc(alice.uid).get()).data();
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(aliceData?.followingCount, 0);
  assert.equal(bobData?.followersCount, 0);
});

test('DELETE /follow: ghost unfollow is a no-op — counts do NOT drift negative (regression)', async () => {
  const token = await alice.getIdToken();
  // No follow exists. Unfollow should be a no-op.
  const res = await callRoute<{ unfollowed: boolean }>(followDelete, 'DELETE', {
    token, params: { uid: bob.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.unfollowed, false);

  // Counts stay at 0 — the legacy batched-without-check write would have
  // decremented to -1 here.
  const aliceData = (await userDoc(alice.uid).get()).data();
  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(aliceData?.followingCount, 0, 'NO negative drift');
  assert.equal(bobData?.followersCount, 0, 'NO negative drift');
});

test('DELETE /follow: concurrent double-unfollow → exactly one decrement', async () => {
  const token = await alice.getIdToken();
  await callRoute(followPost, 'POST', { token, params: { uid: bob.uid } });

  await Promise.all([
    callRoute(followDelete, 'DELETE', { token, params: { uid: bob.uid } }),
    callRoute(followDelete, 'DELETE', { token, params: { uid: bob.uid } }),
  ]);

  const bobData = (await userDoc(bob.uid).get()).data();
  assert.equal(bobData?.followersCount, 0, 'one decrement, not two');
});

// ─── GET /followers + GET /following ─────────────────────────────────────

test('GET /followers: public — no auth required', async () => {
  // Bob has two followers.
  const tokenA = await alice.getIdToken();
  const tokenC = await carol.getIdToken();
  await callRoute(followPost, 'POST', { token: tokenA, params: { uid: bob.uid } });
  await callRoute(followPost, 'POST', { token: tokenC, params: { uid: bob.uid } });

  // No token → still works.
  const res = await callRoute<{ users: Array<{ uid: string }> }>(followersGet, 'GET', {
    params: { uid: bob.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.users.length, 2);
});

test('GET /followers: respects ?limit= query (capped)', async () => {
  const tokenA = await alice.getIdToken();
  const tokenC = await carol.getIdToken();
  await callRoute(followPost, 'POST', { token: tokenA, params: { uid: bob.uid } });
  await callRoute(followPost, 'POST', { token: tokenC, params: { uid: bob.uid } });

  const res = await callRoute<{ users: Array<{ uid: string }> }>(followersGet, 'GET', {
    params: { uid: bob.uid },
    url: 'http://test/api/v1/users/bob/followers?limit=1',
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.users.length, 1);
});

test('GET /following: returns who the user follows', async () => {
  const tokenA = await alice.getIdToken();
  await callRoute(followPost, 'POST', { token: tokenA, params: { uid: bob.uid } });
  await callRoute(followPost, 'POST', { token: tokenA, params: { uid: carol.uid } });

  const res = await callRoute<{ users: Array<{ uid: string }> }>(followingGet, 'GET', {
    params: { uid: alice.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const uids = res.body.data.users.map((u) => u.uid).sort();
  assert.deepEqual(uids, [bob.uid, carol.uid].sort());
});

test('GET /following: empty when user follows no one', async () => {
  const res = await callRoute<{ users: unknown[] }>(followingGet, 'GET', {
    params: { uid: alice.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.users.length, 0);
});
