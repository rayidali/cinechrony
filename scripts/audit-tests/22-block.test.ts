/**
 * LAUNCH 0.5.5 — block a user (full mutual invisibility).
 *
 * Cross-functional tests for blocking: severs follows both ways, prevents
 * follows, hides from search, drops notifications. The block surface
 * itself is exercised in `40-safety-bookmarks-endpoints.test.ts`; this
 * file focuses on the side-effects that touch other endpoints.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { blockUserAs, unblockUserAs } from './lib/safety-helpers.ts';
import { POST as followPost } from '@/app/api/v1/users/[uid]/follow/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { GET as searchGet } from '@/app/api/v1/users/search/route';
import { GET as blockContextGet } from '@/app/api/v1/me/block-context/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

async function searchAs(q: string, viewer: TestUser) {
  const url = `http://test/api/v1/users/search?q=${encodeURIComponent(q)}`;
  const res = await callRoute<{ users: Array<{ uid: string }> }>(
    searchGet, 'GET', { token: await viewer.getIdToken(), url },
  );
  if (res.body.ok !== true) throw new Error('search failed');
  return res.body.data;
}

async function blockContextAs(viewer: TestUser) {
  const res = await callRoute<{ blockedIds: string[]; iBlocked: string[] }>(
    blockContextGet, 'GET', { token: await viewer.getIdToken() },
  );
  if (res.body.ok !== true) throw new Error('block-context failed');
  return res.body.data;
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('block → getMyBlockContext lists the user; unblock clears it', async () => {
  await blockUserAs(alice, bob.uid);

  let ctx = await blockContextAs(alice);
  assert.deepEqual(ctx.iBlocked, [bob.uid]);
  assert.ok(ctx.blockedIds.includes(bob.uid));

  // Bob sees alice as blocking-him too (union, both directions).
  const bobCtx = await blockContextAs(bob);
  assert.ok(bobCtx.blockedIds.includes(alice.uid));
  assert.deepEqual(bobCtx.iBlocked, []);

  await unblockUserAs(alice, bob.uid);
  ctx = await blockContextAs(alice);
  assert.deepEqual(ctx.blockedIds, []);
});

test('blocking severs the follow relationship in both directions', async () => {
  const db = adminDb();
  await db.collection('users').doc(alice.uid).set({ followingCount: 1, followersCount: 1 });
  await db.collection('users').doc(bob.uid).set({ followingCount: 1, followersCount: 1 });
  await db.collection('users').doc(alice.uid).collection('following').doc(bob.uid).set({ id: bob.uid });
  await db.collection('users').doc(bob.uid).collection('followers').doc(alice.uid).set({ id: alice.uid });
  await db.collection('users').doc(bob.uid).collection('following').doc(alice.uid).set({ id: alice.uid });
  await db.collection('users').doc(alice.uid).collection('followers').doc(bob.uid).set({ id: bob.uid });

  await blockUserAs(alice, bob.uid);

  const exists = async (path: string) => (await db.doc(path).get()).exists;
  assert.equal(await exists(`users/${alice.uid}/following/${bob.uid}`), false);
  assert.equal(await exists(`users/${bob.uid}/followers/${alice.uid}`), false);
  assert.equal(await exists(`users/${bob.uid}/following/${alice.uid}`), false);
  assert.equal(await exists(`users/${alice.uid}/followers/${bob.uid}`), false);
});

test('a blocked user cannot follow you', async () => {
  await blockUserAs(alice, bob.uid);
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
  let res = await searchAs('bob', alice);
  assert.ok(res.users.some((u) => u.uid === bob.uid), 'found before block');

  await blockUserAs(alice, bob.uid);
  res = await searchAs('bob', alice);
  assert.ok(!res.users.some((u) => u.uid === bob.uid), 'hidden after block');
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

  await blockUserAs(alice, bob.uid);
  res = await callRoute<{ notifications: unknown[] }>(notificationsGet, 'GET', {
    token: aliceToken,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.notifications.length, 0, 'notification hidden after block');
});
