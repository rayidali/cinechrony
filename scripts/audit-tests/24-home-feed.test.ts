/**
 * LAUNCH 0.5.4 (part 2) — the merged home feed + post likes.
 *
 * getHomeFeed interleaves /activities + /posts by time, paginates with a
 * timestamp cursor, and drops blocked users. likePost / unlikePost mirror the
 * hardened transactional like.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let getHomeFeed: (idToken: unknown, cursor?: string, limit?: number) => Promise<any>;
let likePost: (idToken: unknown, postId: string) => Promise<any>;
let unlikePost: (idToken: unknown, postId: string) => Promise<any>;
let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ getHomeFeed, likePost, unlikePost, blockUser } = await import('@/app/actions'));
});

async function seedActivity(id: string, userId: string, atMs: number) {
  await adminDb().collection('activities').doc(id).set({
    userId, type: 'rated', tmdbId: 1, movieTitle: id, moviePosterUrl: null,
    movieYear: '2024', mediaType: 'movie', likes: 0, likedBy: [],
    createdAt: new Date(atMs),
  });
}
async function seedPost(id: string, authorId: string, atMs: number) {
  await adminDb().collection('posts').doc(id).set({
    id, authorId, authorUsername: authorId, text: id, media: [],
    taggedMovie: null, taggedUserIds: [], taggedUsers: [], place: null,
    likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(atMs), updatedAt: new Date(atMs),
  });
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('getHomeFeed merges activities + posts newest-first', async () => {
  await seedActivity('act-old', bob.uid, 1_000);
  await seedPost('post-mid', bob.uid, 2_000);
  await seedActivity('act-new', bob.uid, 3_000);

  const res = await callActionAs(alice, getHomeFeed);
  assert.equal(res.items.length, 3);
  assert.equal(res.items[0].kind, 'activity');
  assert.equal(res.items[0].activity.id, 'act-new');
  assert.equal(res.items[1].kind, 'post');
  assert.equal(res.items[1].post.id, 'post-mid');
  assert.equal(res.items[2].activity.id, 'act-old');
});

test('getHomeFeed drops a blocked author', async () => {
  await seedPost('bobs-post', bob.uid, 5_000);
  await seedActivity('alice-act', alice.uid, 4_000);
  await callActionAs(alice, blockUser, bob.uid);

  const res = await callActionAs(alice, getHomeFeed);
  const ids = res.items.map((i: any) => (i.kind === 'post' ? i.post.id : i.activity.id));
  assert.ok(!ids.includes('bobs-post'), "blocked bob's post is hidden");
  assert.ok(ids.includes('alice-act'));
});

test('getHomeFeed paginates with a timestamp cursor', async () => {
  for (let i = 0; i < 5; i++) await seedActivity(`a${i}`, bob.uid, 1_000 + i * 1_000);
  const page1 = await callActionAs(alice, getHomeFeed, undefined, 3);
  assert.equal(page1.items.length, 3);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);

  const page2 = await callActionAs(alice, getHomeFeed, page1.nextCursor, 3);
  assert.equal(page2.items.length, 2);
  assert.equal(page2.hasMore, false);
});

test('likePost → likes 1 and notifies the author', async () => {
  await seedPost('p1', bob.uid, 9_000);
  const res = await callActionAs(alice, likePost, 'p1');
  assert.equal(res.success, true);
  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.likes, 1);
  assert.deepEqual(post?.likedBy, [alice.uid]);

  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  assert.ok(notifs.docs.some((d) => d.data().type === 'post_like'));
});

test('concurrent double-like keeps the count at 1', async () => {
  await seedPost('p1', bob.uid, 9_000);
  await Promise.all([
    callActionAs(alice, likePost, 'p1'),
    callActionAs(alice, likePost, 'p1'),
  ]);
  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.likes, 1);

  await callActionAs(alice, unlikePost, 'p1');
  const after = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(after?.likes, 0);
});

test('a forged token cannot like a post', async () => {
  await seedPost('p1', bob.uid, 9_000);
  assert.ok('error' in (await callActionWithRawToken('', likePost, 'p1')));
});

test('getHomeFeed carries only rated/reviewed activities — not added/watched', async () => {
  const seedTyped = (id: string, type: string, atMs: number) =>
    adminDb().collection('activities').doc(id).set({
      userId: bob.uid, type, tmdbId: 1, movieTitle: id, moviePosterUrl: null,
      movieYear: '2024', mediaType: 'movie', likes: 0, likedBy: [],
      createdAt: new Date(atMs),
    });
  await seedTyped('rated-act', 'rated', 4_000);
  await seedTyped('reviewed-act', 'reviewed', 3_000);
  await seedTyped('added-act', 'added', 2_000);
  await seedTyped('watched-act', 'watched', 1_000);

  const res = await callActionAs(alice, getHomeFeed);
  const ids = res.items
    .filter((i: any) => i.kind === 'activity')
    .map((i: any) => i.activity.id);
  assert.ok(ids.includes('rated-act') && ids.includes('reviewed-act'));
  assert.ok(!ids.includes('added-act'), 'added activities stay out of the feed');
  assert.ok(!ids.includes('watched-act'), 'watched activities stay out of the feed');
});
