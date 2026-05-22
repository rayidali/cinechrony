/**
 * LAUNCH 0.5.4 (Phase 10) — post comments.
 *
 * createPostComment / getPostComments / deletePostComment / likePostComment —
 * 1-level threading, count maintenance, author notifications, block filtering.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let createPostComment: (idToken: unknown, postId: string, text: string, parentId?: string | null) => Promise<any>;
let getPostComments: (postId: string, viewerIdToken?: unknown) => Promise<any>;
let deletePostComment: (idToken: unknown, postId: string, commentId: string) => Promise<any>;
let likePostComment: (idToken: unknown, postId: string, commentId: string) => Promise<any>;
let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser;

before(async () => {
  setupTestEnv();
  ({ createPostComment, getPostComments, deletePostComment, likePostComment, blockUser } =
    await import('@/app/actions'));
});

async function seedPost(id: string, authorId: string) {
  await adminDb().collection('posts').doc(id).set({
    id, authorId, authorUsername: authorId, text: 'a post', media: [],
    taggedMovie: null, taggedUserIds: [], taggedUsers: [], place: null,
    likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
}
const postDoc = (id: string) => adminDb().collection('posts').doc(id).get().then((s) => s.data());

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
  await adminDb().collection('users').doc(bob.uid).set({ username: 'bob', displayName: 'Bob' });
  await adminDb().collection('users').doc(carol.uid).set({ username: 'carol', displayName: 'Carol' });
  await seedPost('P1', alice.uid);
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('comment on a post → stored, commentCount incremented, author notified', async () => {
  const res = await callActionAs(bob, createPostComment, 'P1', 'loved this');
  assert.equal(res.success, true);
  assert.equal((await postDoc('P1'))?.commentCount, 1);

  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', alice.uid).get();
  assert.ok(notifs.docs.some((d) => d.data().type === 'post_comment'));
});

test('a reply bumps the parent replyCount, not commentCount', async () => {
  const top = await callActionAs(bob, createPostComment, 'P1', 'top-level');
  const reply = await callActionAs(carol, createPostComment, 'P1', 'a reply', top.commentId);
  assert.equal(reply.success, true);
  assert.equal((await postDoc('P1'))?.commentCount, 1, 'commentCount counts only top-level');

  const parent = await adminDb()
    .collection('posts').doc('P1').collection('comments').doc(top.commentId).get();
  assert.equal(parent.data()?.replyCount, 1);
});

test('an empty comment / a forged token are rejected', async () => {
  assert.ok('error' in (await callActionAs(bob, createPostComment, 'P1', '   ')));
  assert.ok('error' in (await callActionWithRawToken('', createPostComment, 'P1', 'hi')));
});

test('the comment author and the post author can delete; others cannot', async () => {
  const { commentId } = await callActionAs(bob, createPostComment, 'P1', 'bob comment');
  assert.ok('error' in (await callActionAs(carol, deletePostComment, 'P1', commentId)));
  // post author (alice) can moderate it
  assert.equal((await callActionAs(alice, deletePostComment, 'P1', commentId)).success, true);
  assert.equal((await postDoc('P1'))?.commentCount, 0);
});

test('getPostComments hides a blocked user’s comments', async () => {
  await callActionAs(bob, createPostComment, 'P1', 'from bob');
  await callActionAs(carol, createPostComment, 'P1', 'from carol');

  let res = await getPostComments('P1', await alice.getIdToken());
  assert.equal(res.comments.length, 2);

  await callActionAs(alice, blockUser, carol.uid);
  res = await getPostComments('P1', await alice.getIdToken());
  assert.equal(res.comments.length, 1);
  assert.equal(res.comments[0].userId, bob.uid);
});

test('likePostComment increments the like count', async () => {
  const { commentId } = await callActionAs(bob, createPostComment, 'P1', 'like me');
  const res = await callActionAs(carol, likePostComment, 'P1', commentId);
  assert.equal(res.success, true);
  assert.equal(res.likes, 1);
});
