/**
 * LAUNCH 0.5.1 — like / unlike public lists.
 *
 * `likeList`/`unlikeList` clone the hardened `likeReview` pattern:
 * verifyCaller → rate-limit → transactional read-check-write. This asserts
 *  - only public lists are likeable;
 *  - `likes` never drifts from `likedBy.length` under a concurrent burst;
 *  - a forged token is rejected;
 *  - the owner gets a `list_like` notification;
 *  - the shared `like` rate-limit bucket trips.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let likeList: (idToken: unknown, ownerId: string, listId: string) => Promise<any>;
let unlikeList: (idToken: unknown, ownerId: string, listId: string) => Promise<any>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ likeList, unlikeList } = await import('@/app/actions'));
});

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

test('like a public list → likes 1, likedBy holds the liker', async () => {
  await seedList(bob.uid, 'L1', true);
  const res = await callActionAs(alice, likeList, bob.uid, 'L1');
  assert.equal(res.success, true);
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 1);
  assert.deepEqual(d?.likedBy, [alice.uid]);
});

test('private lists cannot be liked', async () => {
  await seedList(bob.uid, 'L1', false);
  const res = await callActionAs(alice, likeList, bob.uid, 'L1');
  assert.deepEqual(res, { error: 'Only public lists can be liked.' });
});

test('concurrent double-like by the SAME user → likes 1, not 2', async () => {
  await seedList(bob.uid, 'L1', true);
  await Promise.all([
    callActionAs(alice, likeList, bob.uid, 'L1'),
    callActionAs(alice, likeList, bob.uid, 'L1'),
  ]);
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 1, 'likes did not double-count');
  assert.equal(d?.likes, (d?.likedBy as string[]).length, 'count matches array');
});

test('like then unlike returns to zero', async () => {
  await seedList(bob.uid, 'L1', true);
  await callActionAs(alice, likeList, bob.uid, 'L1');
  await callActionAs(alice, unlikeList, bob.uid, 'L1');
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 0);
  assert.deepEqual(d?.likedBy, []);
});

test('like already-liked / unlike not-liked are rejected', async () => {
  await seedList(bob.uid, 'L1', true);
  await callActionAs(alice, likeList, bob.uid, 'L1');
  assert.deepEqual(await callActionAs(alice, likeList, bob.uid, 'L1'), { error: 'Already liked.' });
  await callActionAs(alice, unlikeList, bob.uid, 'L1');
  assert.deepEqual(await callActionAs(alice, unlikeList, bob.uid, 'L1'), { error: 'Not liked yet.' });
});

test('a forged / empty token is rejected', async () => {
  await seedList(bob.uid, 'L1', true);
  const res = await callActionWithRawToken('', likeList, bob.uid, 'L1');
  assert.ok('error' in res, 'empty token must be rejected');
  const d = await listDoc(bob.uid, 'L1');
  assert.equal(d?.likes, 0, 'no like was recorded');
});

test('liking a list notifies its owner', async () => {
  await seedList(bob.uid, 'L1', true);
  await callActionAs(alice, likeList, bob.uid, 'L1');
  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  const likeNotif = notifs.docs.map((d) => d.data()).find((n) => n.type === 'list_like');
  assert.ok(likeNotif, 'a list_like notification was created');
  assert.equal(likeNotif?.fromUserId, alice.uid);
  assert.equal(likeNotif?.listId, 'L1');
});

test('the shared `like` rate-limit bucket trips', async () => {
  // 60 likes/60s. Self-owned public lists keep the test fast (no notifications).
  const COUNT = 62;
  for (let i = 0; i < COUNT; i++) await seedList(alice.uid, `L${i}`, true);
  let lastError: unknown = null;
  for (let i = 0; i < COUNT; i++) {
    const res = await callActionAs(alice, likeList, alice.uid, `L${i}`);
    if (res?.error) lastError = res.error;
  }
  assert.ok(lastError, 'rate limit tripped before all 62 likes went through');
});
