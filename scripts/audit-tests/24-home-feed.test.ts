/**
 * LAUNCH 0.5.4 (part 2) — the merged home feed + post likes.
 *
 * Migrated to /api/v1 routes in Phase A PR #11. The feed-merge,
 * block-filtering, and transactional like invariants from the legacy
 * actions are preserved in `src/lib/posts-server.ts` and exercised
 * end-to-end through the route handlers here.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { blockUserAs } from './lib/safety-helpers.ts';
import { GET as homeFeedGet } from '@/app/api/v1/home-feed/route';
import { POST as likePost, DELETE as unlikePost } from '@/app/api/v1/posts/[id]/like/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

async function seedPost(id: string, authorId: string, atMs: number) {
  await adminDb().collection('posts').doc(id).set({
    id, authorId, authorUsername: authorId, text: id, media: [],
    taggedMovie: null, taggedUserIds: [], taggedUsers: [], place: null,
    likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(atMs), updatedAt: new Date(atMs),
  });
}

async function feedAs(user: TestUser | null, opts: { cursor?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  return callRoute<{ items: Array<{ kind: string; post?: { id: string }; activity?: { id: string; type: string } }>; hasMore: boolean; nextCursor?: string }>(
    homeFeedGet, 'GET',
    {
      token: user ? await user.getIdToken() : undefined,
      url: `http://test/api/v1/home-feed${qs.toString() ? `?${qs.toString()}` : ''}`,
    },
  );
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('home-feed returns posts newest-first', async () => {
  await seedPost('post-old', bob.uid, 1_000);
  await seedPost('post-mid', bob.uid, 2_000);
  await seedPost('post-new', bob.uid, 3_000);

  const res = await feedAs(alice);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const items = res.body.data.items;
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.kind === 'post'), 'feed is posts-only');
  assert.equal(items[0].post?.id, 'post-new');
  assert.equal(items[1].post?.id, 'post-mid');
  assert.equal(items[2].post?.id, 'post-old');
});

test('home-feed drops a blocked author', async () => {
  await seedPost('bobs-post', bob.uid, 5_000);
  await seedPost('alice-post', alice.uid, 4_000);
  await blockUserAs(alice, bob.uid);

  const res = await feedAs(alice);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const ids = res.body.data.items.map((i) => i.post!.id);
  assert.ok(!ids.includes('bobs-post'), "blocked bob's post is hidden");
  assert.ok(ids.includes('alice-post'));
});

test('home-feed paginates with a timestamp cursor', async () => {
  for (let i = 0; i < 5; i++) await seedPost(`p${i}`, bob.uid, 1_000 + i * 1_000);
  const page1 = await feedAs(alice, { limit: 3 });
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.items.length, 3);
  assert.equal(page1.body.data.hasMore, true);
  assert.ok(page1.body.data.nextCursor);

  const page2 = await feedAs(alice, { cursor: page1.body.data.nextCursor, limit: 3 });
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.items.length, 2);
  assert.equal(page2.body.data.hasMore, false);
});

test('POST /posts/[id]/like → likes 1 and notifies the author', async () => {
  await seedPost('p1', bob.uid, 9_000);
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(likePost, 'POST', { token: aliceToken, params: { id: 'p1' } });
  assert.equal(res.status, 200);

  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.likes, 1);
  assert.deepEqual(post?.likedBy, [alice.uid]);

  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  assert.ok(notifs.docs.some((d) => d.data().type === 'post_like'));
});

test('concurrent double-like keeps the count at 1', async () => {
  await seedPost('p1', bob.uid, 9_000);
  const aliceToken = await alice.getIdToken();
  await Promise.all([
    callRoute(likePost, 'POST', { token: aliceToken, params: { id: 'p1' } }),
    callRoute(likePost, 'POST', { token: aliceToken, params: { id: 'p1' } }),
  ]);
  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.likes, 1);

  await callRoute(unlikePost, 'DELETE', { token: aliceToken, params: { id: 'p1' } });
  const after = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(after?.likes, 0);
});

test('a forged token cannot like a post', async () => {
  await seedPost('p1', bob.uid, 9_000);
  const res = await callRoute(likePost, 'POST', { token: '', params: { id: 'p1' } });
  assert.equal(res.status, 401);
});

test('home-feed excludes ALL system activities (posts-only reel)', async () => {
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
  await seedPost('a-post', bob.uid, 5_000);

  const res = await feedAs(alice);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const items = res.body.data.items;
  assert.ok(items.every((i) => i.kind === 'post'), 'no system activities appear in the feed');
  assert.equal(items.length, 1, 'only the post survives');
  assert.equal(items[0].post?.id, 'a-post');
});
