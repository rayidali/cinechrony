/**
 * LAUNCH 0.5.1 — like / unlike public lists.
 *
 * Migrated to /api/v1 routes in Phase A PR #9 — see
 * `src/lib/lists-server.ts` and the route file at
 * `src/app/api/v1/lists/[ownerId]/[listId]/like/route.ts`.
 *
 * Invariants asserted:
 *  - only public lists are likeable;
 *  - `likes` never drifts from `likedBy.length` under a concurrent burst;
 *  - a forged token is rejected;
 *  - the owner gets a `list_like` notification;
 *  - the shared `like` rate-limit bucket trips.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as likePost, DELETE as unlikeDelete }
  from '@/app/api/v1/lists/[ownerId]/[listId]/like/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

/** Seed a list owned by `ownerUid`. */
async function seedList(ownerUid: string, listId: string, isPublic: boolean) {
  await adminDb()
    .collection('users').doc(ownerUid)
    .collection('lists').doc(listId)
    .set({ id: listId, name: `list ${listId}`, ownerId: ownerUid, isPublic, likes: 0, likedBy: [] });
}

const listDoc = (ownerUid: string, listId: string) =>
  adminDb().collection('users').doc(ownerUid).collection('lists').doc(listId)
    .get().then((s) => s.data());

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function like(user: TestUser, ownerUid: string, listId: string) {
  return callRoute(likePost, 'POST', {
    token: await user.getIdToken(), params: { ownerId: ownerUid, listId },
  });
}

async function unlike(user: TestUser, ownerUid: string, listId: string) {
  return callRoute(unlikeDelete, 'DELETE', {
    token: await user.getIdToken(), params: { ownerId: ownerUid, listId },
  });
}

test('like a public list → likes 1, likedBy holds the liker', async () => {
  await seedList(bob.uid, 'L1', true);
  const res = await like(alice, bob.uid, 'L1');
  assert.equal(res.status, 200);
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 1);
  assert.deepEqual(d?.likedBy, [alice.uid]);
});

test('private lists cannot be liked', async () => {
  await seedList(bob.uid, 'L1', false);
  const res = await like(alice, bob.uid, 'L1');
  assert.equal(res.status, 403);
});

test('concurrent double-like by the SAME user → likes 1, not 2', async () => {
  await seedList(bob.uid, 'L1', true);
  await Promise.all([like(alice, bob.uid, 'L1'), like(alice, bob.uid, 'L1')]);
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 1, 'likes did not double-count');
  assert.equal(d?.likes, (d?.likedBy as string[]).length, 'count matches array');
});

test('like then unlike returns to zero', async () => {
  await seedList(bob.uid, 'L1', true);
  await like(alice, bob.uid, 'L1');
  await unlike(alice, bob.uid, 'L1');
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 0);
  assert.deepEqual(d?.likedBy, []);
});

test('like already-liked / unlike not-liked are rejected with 409', async () => {
  await seedList(bob.uid, 'L1', true);
  await like(alice, bob.uid, 'L1');
  const dupeLike = await like(alice, bob.uid, 'L1');
  assert.equal(dupeLike.status, 409);
  await unlike(alice, bob.uid, 'L1');
  const ghostUnlike = await unlike(alice, bob.uid, 'L1');
  assert.equal(ghostUnlike.status, 409);
});

test('a forged / empty token is rejected', async () => {
  await seedList(bob.uid, 'L1', true);
  const res = await callRoute(likePost, 'POST', {
    token: '', params: { ownerId: bob.uid, listId: 'L1' },
  });
  assert.equal(res.status, 401, 'empty token must be rejected');
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 0, 'no like was recorded');
});

test('liking a list notifies its owner', async () => {
  await seedList(bob.uid, 'L1', true);
  await like(alice, bob.uid, 'L1');
  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  const likeNotif = notifs.docs.map((d) => d.data()).find((n) => n.type === 'list_like');
  assert.ok(likeNotif, 'a list_like notification was created');
  assert.equal(likeNotif?.fromUserId, alice.uid);
  assert.equal(likeNotif?.listId, 'L1');
});

test('list members (owner + collaborator) cannot like their own list', async () => {
  // Owner can't like their own list.
  await seedList(alice.uid, 'OWN', true);
  const ownLike = await like(alice, alice.uid, 'OWN');
  assert.equal(ownLike.status, 403);

  // A collaborator can't like a list they're on.
  await adminDb()
    .collection('users').doc(bob.uid)
    .collection('lists').doc('COLLAB')
    .set({
      id: 'COLLAB', name: 'collab', ownerId: bob.uid, isPublic: true,
      likes: 0, likedBy: [], collaboratorIds: [alice.uid],
    });
  const collabLike = await like(alice, bob.uid, 'COLLAB');
  assert.equal(collabLike.status, 403);
});

test('a member can still remove a stale like (self-heal)', async () => {
  // alice collaborates on bob's list AND has a leftover like in likedBy.
  await adminDb()
    .collection('users').doc(bob.uid)
    .collection('lists').doc('STALE')
    .set({
      id: 'STALE', name: 'stale', ownerId: bob.uid, isPublic: true,
      likes: 1, likedBy: [alice.uid], collaboratorIds: [alice.uid],
    });
  const res = await unlike(alice, bob.uid, 'STALE');
  assert.equal(res.status, 200);
  const d = await listDoc(bob.uid, 'STALE');
  assert.equal(d?.likes, 0);
  assert.deepEqual(d?.likedBy, []);
});

test('the shared `like` rate-limit bucket trips', async () => {
  // 60 likes/60s — alice likes bob's lists (she's not a member of any).
  const COUNT = 62;
  for (let i = 0; i < COUNT; i++) await seedList(bob.uid, `L${i}`, true);
  const results: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const r = await like(alice, bob.uid, `L${i}`);
    results.push(r.status);
  }
  assert.equal(results[0], 200, 'the first like succeeds');
  assert.equal(results[COUNT - 1], 429, 'the 62nd like is rate-limited');
});
