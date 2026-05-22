/**
 * LAUNCH 0.5.4 — user posts (composer + backend).
 *
 * createPost / updatePost / deletePost / getPost / getPostMediaUploadUrl.
 * Asserts content guards, owner-only edits, tagged-friend notifications,
 * block-aware tagging, and the presigned-upload validation.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let createPost: (idToken: unknown, input: any) => Promise<any>;
let updatePost: (idToken: unknown, postId: string, input: any) => Promise<any>;
let deletePost: (idToken: unknown, postId: string) => Promise<any>;
let getPost: (postId: string, viewerIdToken?: unknown) => Promise<any>;
let getPostMediaUploadUrl: (idToken: unknown, name: string, type: string, size: number) => Promise<any>;
let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser;

before(async () => {
  setupTestEnv();
  ({ createPost, updatePost, deletePost, getPost, getPostMediaUploadUrl, blockUser } =
    await import('@/app/actions'));
});

async function seedUser(uid: string, username: string) {
  await adminDb().collection('users').doc(uid).set({
    username, displayName: username, followersCount: 0, followingCount: 0,
  });
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
  await seedUser(alice.uid, 'alice');
  await seedUser(bob.uid, 'bob');
  await seedUser(carol.uid, 'carol');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('create a text post → it is stored with the author', async () => {
  const res = await callActionAs(alice, createPost, { text: 'devastating.' });
  assert.equal(res.success, true);
  const doc = await adminDb().collection('posts').doc(res.postId).get();
  assert.equal(doc.data()?.authorId, alice.uid);
  assert.equal(doc.data()?.text, 'devastating.');
});

test('an empty post is rejected', async () => {
  const res = await callActionAs(alice, createPost, { text: '   ' });
  assert.ok('error' in res);
});

test('a forged token cannot post', async () => {
  const res = await callActionWithRawToken('', createPost, { text: 'hi' });
  assert.ok('error' in res);
});

test('tagged friends are notified; blocked users cannot be tagged', async () => {
  await callActionAs(alice, blockUser, carol.uid);
  const res = await callActionAs(alice, createPost, {
    text: 'watched with the crew',
    taggedUserIds: [bob.uid, carol.uid],
  });
  const post = (await adminDb().collection('posts').doc(res.postId).get()).data();
  assert.deepEqual(post?.taggedUserIds, [bob.uid], 'blocked carol dropped from tags');

  const bobNotifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  assert.ok(
    bobNotifs.docs.some((d) => d.data().type === 'post_tag'),
    'bob got a post_tag notification',
  );
});

test('only the author can edit or delete a post', async () => {
  const { postId } = await callActionAs(alice, createPost, { text: 'mine' });
  assert.ok('error' in (await callActionAs(bob, updatePost, postId, { text: 'hacked' })));
  assert.ok('error' in (await callActionAs(bob, deletePost, postId)));
  assert.equal((await callActionAs(alice, deletePost, postId)).success, true);
  assert.equal((await adminDb().collection('posts').doc(postId).get()).exists, false);
});

test('getPost is block-aware', async () => {
  const { postId } = await callActionAs(alice, createPost, { text: 'hello' });
  // bob can see it…
  assert.ok((await getPost(postId, await bob.getIdToken())).post);
  // …until alice blocks bob.
  await callActionAs(alice, blockUser, bob.uid);
  assert.equal((await getPost(postId, await bob.getIdToken())).post, null);
});

test('getPostMediaUploadUrl validates mime + size', async () => {
  assert.ok('error' in (await callActionAs(alice, getPostMediaUploadUrl, 'a.txt', 'text/plain', 100)));
  assert.ok(
    'error' in (await callActionAs(alice, getPostMediaUploadUrl, 'a.mp4', 'video/mp4', 999_000_000)),
    'a 999MB file is rejected',
  );
  assert.ok('error' in (await callActionWithRawToken('', getPostMediaUploadUrl, 'a.jpg', 'image/jpeg', 100)));
});
