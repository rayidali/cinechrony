/**
 * LAUNCH 0.5.4 — user posts (composer + backend).
 *
 * Migrated to /api/v1 routes in Phase A PR #11. createPost / updatePost /
 * deletePost / getPost / getPostMediaUploadUrl all go through the route
 * handlers. The invariants — content guards, owner-only edits,
 * tagged-friend notifications, block-aware tagging + visibility, and
 * presigned-upload validation — are preserved.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as createPostPost } from '@/app/api/v1/posts/route';
import { GET as getPostGet, PATCH as updatePostPatch, DELETE as deletePostDelete }
  from '@/app/api/v1/posts/[id]/route';
import { POST as mediaUploadPost } from '@/app/api/v1/posts/media-upload-url/route';

let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser;

before(async () => {
  setupTestEnv();
  ({ blockUser } = await import('@/app/actions'));
});

async function seedUser(uid: string, username: string) {
  await adminDb().collection('users').doc(uid).set({
    username, usernameLower: username, displayName: username,
    followersCount: 0, followingCount: 0,
  });
}

async function createPostAs(user: TestUser, body: Record<string, unknown>) {
  return callRoute<{ postId: string }>(createPostPost, 'POST', {
    token: await user.getIdToken(),
    body: { taggedMovie: { tmdbId: 1, mediaType: 'movie', title: 'X' }, ...body },
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
  const res = await createPostAs(alice, { text: 'devastating.' });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const doc = await adminDb().collection('posts').doc(res.body.data.postId).get();
  assert.equal(doc.data()?.authorId, alice.uid);
  assert.equal(doc.data()?.text, 'devastating.');
});

test('an empty post is rejected', async () => {
  const res = await callRoute(createPostPost, 'POST', {
    token: await alice.getIdToken(),
    body: { text: '   ', media: [], taggedMovie: null },
  });
  assert.equal(res.status, 400);
});

test('a forged token cannot post', async () => {
  const res = await callRoute(createPostPost, 'POST', {
    token: '', body: { text: 'hi', taggedMovie: { tmdbId: 1, mediaType: 'movie', title: 'X' } },
  });
  assert.equal(res.status, 401);
});

test('tagged friends are notified; blocked users cannot be tagged', async () => {
  await callActionAs(alice, blockUser, carol.uid);
  const res = await createPostAs(alice, {
    text: 'watched with the crew',
    taggedUserIds: [bob.uid, carol.uid],
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  const post = (await adminDb().collection('posts').doc(res.body.data.postId).get()).data();
  assert.deepEqual(post?.taggedUserIds, [bob.uid], 'blocked carol dropped from tags');

  const bobNotifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  assert.ok(
    bobNotifs.docs.some((d) => d.data().type === 'post_tag'),
    'bob got a post_tag notification',
  );
});

test('only the author can edit or delete a post', async () => {
  const created = await createPostAs(alice, { text: 'mine' });
  if (created.body.ok !== true) return assert.fail('expected ok');
  const postId = created.body.data.postId;

  const bobToken = await bob.getIdToken();
  const hijackUpdate = await callRoute(updatePostPatch, 'PATCH', {
    token: bobToken, params: { id: postId },
    body: { text: 'hacked', taggedMovie: { tmdbId: 1, mediaType: 'movie', title: 'X' } },
  });
  assert.equal(hijackUpdate.status, 403);

  const hijackDelete = await callRoute(deletePostDelete, 'DELETE', {
    token: bobToken, params: { id: postId },
  });
  assert.equal(hijackDelete.status, 403);

  const aliceToken = await alice.getIdToken();
  const ok = await callRoute(deletePostDelete, 'DELETE', {
    token: aliceToken, params: { id: postId },
  });
  assert.equal(ok.status, 200);
  assert.equal((await adminDb().collection('posts').doc(postId).get()).exists, false);
});

test('GET /posts/[id] is block-aware', async () => {
  const created = await createPostAs(alice, { text: 'hello' });
  if (created.body.ok !== true) return assert.fail('expected ok');
  const postId = created.body.data.postId;

  const bobToken = await bob.getIdToken();
  const beforeBlock = await callRoute<{ post: unknown }>(getPostGet, 'GET', {
    token: bobToken, params: { id: postId },
  });
  if (beforeBlock.body.ok !== true) return assert.fail('expected ok');
  assert.ok(beforeBlock.body.data.post, 'bob can see it');

  await callActionAs(alice, blockUser, bob.uid);

  const afterBlock = await callRoute<{ post: unknown }>(getPostGet, 'GET', {
    token: bobToken, params: { id: postId },
  });
  if (afterBlock.body.ok !== true) return assert.fail('expected ok');
  assert.equal(afterBlock.body.data.post, null, 'blocked → null');
});

test('media-upload-url validates mime + size + auth', async () => {
  const aliceToken = await alice.getIdToken();

  const badType = await callRoute(mediaUploadPost, 'POST', {
    token: aliceToken,
    body: { fileName: 'a.txt', contentType: 'text/plain', fileSize: 100 },
  });
  assert.equal(badType.status, 400);

  const tooBig = await callRoute(mediaUploadPost, 'POST', {
    token: aliceToken,
    body: { fileName: 'a.mp4', contentType: 'video/mp4', fileSize: 999_000_000 },
  });
  assert.equal(tooBig.status, 400);

  const unauth = await callRoute(mediaUploadPost, 'POST', {
    body: { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: 100 },
  });
  assert.equal(unauth.status, 401);
});
