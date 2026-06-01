/**
 * LAUNCH 0.5.5 — block a user (full mutual invisibility).
 *
 * blockUser / unblockUser / getMyBlockContext plus the cross-cutting
 * enforcement: a block severs follows both ways, blocks following, and hides
 * the blocked user from search + notifications.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as followPost } from '@/app/api/v1/users/[uid]/follow/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';

let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let unblockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let getMyBlockContext: (idToken: unknown) => Promise<any>;
let searchUsers: (q: string, currentUserId?: string) => Promise<any>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ blockUser, unblockUser, getMyBlockContext, searchUsers } =
    await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('block → getMyBlockContext lists the user; unblock clears it', async () => {
  await callActionAs(alice, blockUser, bob.uid);
  let ctx = await callActionAs(alice, getMyBlockContext);
  assert.deepEqual(ctx.iBlocked, [bob.uid]);
  assert.ok(ctx.blockedIds.includes(bob.uid));

  // Bob sees alice as blocking-him too (union, both directions).
  const bobCtx = await callActionAs(bob, getMyBlockContext);
  assert.ok(bobCtx.blockedIds.includes(alice.uid));
  assert.deepEqual(bobCtx.iBlocked, []);

  await callActionAs(alice, unblockUser, bob.uid);
  ctx = await callActionAs(alice, getMyBlockContext);
  assert.deepEqual(ctx.blockedIds, []);
});

test('a user cannot block themselves; a forged token cannot block', async () => {
  assert.deepEqual(await callActionAs(alice, blockUser, alice.uid), { error: 'Invalid user.' });
  assert.ok('error' in (await callActionWithRawToken('', blockUser, bob.uid)));
});

test('blocking severs the follow relationship in both directions', async () => {
  // Seed: alice ⇄ bob mutual follow.
  const db = adminDb();
  await db.collection('users').doc(alice.uid).set({ followingCount: 1, followersCount: 1 });
  await db.collection('users').doc(bob.uid).set({ followingCount: 1, followersCount: 1 });
  await db.collection('users').doc(alice.uid).collection('following').doc(bob.uid).set({ id: bob.uid });
  await db.collection('users').doc(bob.uid).collection('followers').doc(alice.uid).set({ id: alice.uid });
  await db.collection('users').doc(bob.uid).collection('following').doc(alice.uid).set({ id: alice.uid });
  await db.collection('users').doc(alice.uid).collection('followers').doc(bob.uid).set({ id: bob.uid });

  await callActionAs(alice, blockUser, bob.uid);

  const exists = async (path: string) => (await db.doc(path).get()).exists;
  assert.equal(await exists(`users/${alice.uid}/following/${bob.uid}`), false);
  assert.equal(await exists(`users/${bob.uid}/followers/${alice.uid}`), false);
  assert.equal(await exists(`users/${bob.uid}/following/${alice.uid}`), false);
  assert.equal(await exists(`users/${alice.uid}/followers/${bob.uid}`), false);
});

test('a blocked user cannot follow you', async () => {
  await callActionAs(alice, blockUser, bob.uid);
  // Need a users/{uid} doc for the route's target-exists check.
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', followersCount: 0, followingCount: 0,
  }, { merge: true });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(followPost, 'POST', {
    token: bobToken, params: { uid: alice.uid },
  });
  // Block in either direction → 403 FollowBlockedError.
  assert.equal(res.status, 403);
});

test('a blocked user is excluded from search', async () => {
  await adminDb().collection('users').doc(bob.uid).set({
    username: 'bobby', usernameLower: 'bobby',
    displayName: 'Bob', displayNameLower: 'bob',
    followersCount: 0, followingCount: 0,
  });
  // Visible before the block.
  let res = await searchUsers('bob', alice.uid);
  assert.ok(res.users.some((u: any) => u.uid === bob.uid), 'found before block');

  await callActionAs(alice, blockUser, bob.uid);
  res = await searchUsers('bob', alice.uid);
  assert.ok(!res.users.some((u: any) => u.uid === bob.uid), 'hidden after block');
});

test('a blocked user’s notifications are dropped', async () => {
  await adminDb().collection('notifications').add({
    userId: alice.uid, type: 'follow', fromUserId: bob.uid,
    fromUsername: 'bobby', read: false, createdAt: new Date(),
  });
  const aliceToken = await alice.getIdToken();

  let res = await callRoute<{ notifications: unknown[] }>(notificationsGet, 'GET', {
    token: aliceToken,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.notifications.length, 1, 'notification visible before block');

  await callActionAs(alice, blockUser, bob.uid);
  res = await callRoute<{ notifications: unknown[] }>(notificationsGet, 'GET', {
    token: aliceToken,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.notifications.length, 0, 'notification hidden after block');
});
