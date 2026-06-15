/**
 * Phase A.3 PR #11 — posts-namespace endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/posts                       createPost (rate-limit, validation, notifications, rating upsert)
 *   - GET    /api/v1/posts/[id]                  getPost (block-aware, null on cross-block)
 *   - PATCH  /api/v1/posts/[id]                  updatePost (owner-only)
 *   - DELETE /api/v1/posts/[id]                  deletePost (owner-only)
 *   - POST   /api/v1/posts/media-upload-url      validation (R2 config-dependent, partial here)
 *   - POST   /api/v1/posts/[id]/like             likePost (transactional, AUDIT 3.5 fourth leg)
 *   - DELETE /api/v1/posts/[id]/like             unlikePost (transactional)
 *   - GET    /api/v1/home-feed                   merged activities + posts (block-filtered)
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as createPost } from '@/app/api/v1/posts/route';
import { GET as getPost, PATCH as patchPost, DELETE as deletePost } from '@/app/api/v1/posts/[id]/route';
import { POST as likePost, DELETE as unlikePost } from '@/app/api/v1/posts/[id]/like/route';
import { POST as mediaUploadUrl } from '@/app/api/v1/posts/media-upload-url/route';
import { GET as homeFeed } from '@/app/api/v1/home-feed/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', usernameLower: 'alice',
  });
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob', usernameLower: 'bob',
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const postDoc = (id: string) => adminDb().collection('posts').doc(id);

const sampleTaggedMovie = {
  tmdbId: 603, mediaType: 'movie' as const, title: 'The Matrix',
  posterUrl: 'http://example/p.jpg', year: '1999',
};

// ─── POST /posts ─────────────────────────────────────────────────────────

test('POST /posts: unauth → 401', async () => {
  const res = await callRoute(createPost, 'POST', {
    body: { text: 'hi', taggedMovie: sampleTaggedMovie },
  });
  assert.equal(res.status, 401);
});

test('POST /posts: empty everything → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(createPost, 'POST', {
    token, body: { text: '', media: [], taggedMovie: null },
  });
  assert.equal(res.status, 400);
});

test('POST /posts: out-of-range rating → 400', async () => {
  const token = await alice.getIdToken();
  for (const rating of [0, 0.99, 10.01, 12, -1]) {
    const res = await callRoute(createPost, 'POST', {
      token, body: { text: 'x', taggedMovie: sampleTaggedMovie, rating },
    });
    assert.equal(res.status, 400, `rating ${rating} should reject`);
  }
});

test('POST /posts: happy path persists post', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ postId: string }>(createPost, 'POST', {
    token, body: { text: 'banger', taggedMovie: sampleTaggedMovie },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');

  const stored = await postDoc(res.body.data.postId).get();
  assert.equal(stored.data()?.authorId, alice.uid);
  assert.equal(stored.data()?.text, 'banger');
});

test('POST /posts: rating upserts /ratings (post = unified review+rating)', async () => {
  const token = await alice.getIdToken();
  await callRoute(createPost, 'POST', {
    token, body: { text: 'great', taggedMovie: sampleTaggedMovie, rating: 9 },
  });

  const rating = await adminDb().collection('ratings').doc(`${alice.uid}_603`).get();
  assert.equal(rating.exists, true);
  assert.equal(rating.data()?.rating, 9);
});

test('POST /posts: @-mention fans out post_tag notification', async () => {
  const token = await alice.getIdToken();
  await callRoute(createPost, 'POST', {
    token, body: { text: 'hey @bob check this', taggedMovie: sampleTaggedMovie },
  });

  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', bob.uid)
    .where('type', '==', 'post_tag')
    .get();
  assert.equal(notifs.size, 1);
});

// ─── GET /posts/[id] (block-aware) ───────────────────────────────────────

test('GET /posts/[id]: anonymous viewer sees the post', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'public', likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const res = await callRoute<{ post: { authorId: string } | null }>(getPost, 'GET', {
    params: { id: 'p1' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.post?.authorId, alice.uid);
});

test('GET /posts/[id]: viewer blocked by author → null (LAUNCH 0.5.5)', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'public', likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
  // Alice blocks Bob.
  await adminDb().collection('blocks').doc(`${alice.uid}_${bob.uid}`).set({
    blockerId: alice.uid, blockedId: bob.uid,
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute<{ post: unknown }>(getPost, 'GET', {
    token: bobToken, params: { id: 'p1' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.post, null);
});

test('GET /posts/[id]: missing → null (not 404)', async () => {
  const res = await callRoute<{ post: unknown }>(getPost, 'GET', {
    params: { id: 'no-such' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.post, null);
});

// ─── PATCH /posts/[id] ───────────────────────────────────────────────────

test('PATCH /posts/[id]: non-owner → 403', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'mine', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(patchPost, 'PATCH', {
    token: bobToken, params: { id: 'p1' },
    body: { text: 'hijacked', taggedMovie: sampleTaggedMovie },
  });
  assert.equal(res.status, 403);
});

test('PATCH /posts/[id]: owner updates text + writes editedAt', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'original', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(2024, 0, 1), updatedAt: new Date(2024, 0, 1),
  });
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(patchPost, 'PATCH', {
    token: aliceToken, params: { id: 'p1' },
    body: { text: 'edited', taggedMovie: sampleTaggedMovie },
  });
  assert.equal(res.status, 200);
  const after = (await postDoc('p1').get()).data();
  assert.equal(after?.text, 'edited');
  assert.ok(after?.editedAt, 'editedAt set');
});

// ─── DELETE /posts/[id] ──────────────────────────────────────────────────

test('DELETE /posts/[id]: non-owner → 403', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'mine', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(deletePost, 'DELETE', {
    token: bobToken, params: { id: 'p1' },
  });
  assert.equal(res.status, 403);
});

test('DELETE /posts/[id]: owner deletes', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'mine', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(deletePost, 'DELETE', {
    token: aliceToken, params: { id: 'p1' },
  });
  assert.equal(res.status, 200);
  assert.equal((await postDoc('p1').get()).exists, false);
});

// ─── POST /posts/media-upload-url ────────────────────────────────────────

test('POST /posts/media-upload-url: non-image / non-video → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(mediaUploadUrl, 'POST', {
    token,
    body: { fileName: 'doc.pdf', contentType: 'application/pdf', fileSize: 1024 },
  });
  assert.equal(res.status, 400);
});

test('POST /posts/media-upload-url: oversize (>200MB) → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(mediaUploadUrl, 'POST', {
    token,
    body: { fileName: 'big.mp4', contentType: 'video/mp4', fileSize: 201 * 1024 * 1024 },
  });
  assert.equal(res.status, 400);
});

// ─── POST + DELETE /posts/[id]/like (AUDIT 3.5) ──────────────────────────

test('POST /posts/[id]/like: increments + writes notification', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'mine', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute<{ likes: number }>(likePost, 'POST', {
    token: bobToken, params: { id: 'p1' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 1);

  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', alice.uid)
    .where('type', '==', 'post_like')
    .get();
  assert.equal(notifs.size, 1);
});

test('POST /posts/[id]/like: concurrent double-like → exactly one increment (AUDIT 3.5)', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'x', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const bobToken = await bob.getIdToken();
  const results = await Promise.allSettled([
    callRoute(likePost, 'POST', { token: bobToken, params: { id: 'p1' } }),
    callRoute(likePost, 'POST', { token: bobToken, params: { id: 'p1' } }),
  ]);
  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort();
  assert.deepEqual(statuses, [200, 409]);

  const after = (await postDoc('p1').get()).data();
  assert.equal(after?.likes, 1);
  assert.equal((after?.likedBy as string[]).length, 1);
});

test('DELETE /posts/[id]/like: not-liked → 409', async () => {
  await postDoc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'x', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(unlikePost, 'DELETE', {
    token: bobToken, params: { id: 'p1' },
  });
  assert.equal(res.status, 409);
});

// ─── GET /home-feed (merged + block-filtered) ────────────────────────────

test('GET /home-feed: posts only, block-filtered (system activities excluded)', async () => {
  // alice posts; bob activity (rated) — now EXCLUDED; carol-posts blocked.
  const carol = await createTestUser('carol');
  await adminDb().collection('posts').doc('p1').set({
    id: 'p1', authorId: alice.uid, text: 'a post', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(2024, 0, 2), updatedAt: new Date(2024, 0, 2),
  });
  await adminDb().collection('posts').doc('p2').set({
    id: 'p2', authorId: carol.uid, text: 'blocked', likes: 0, likedBy: [],
    commentCount: 0, createdAt: new Date(2024, 0, 3), updatedAt: new Date(2024, 0, 3),
  });
  await adminDb().collection('activities').doc('a1').set({
    id: 'a1', userId: bob.uid, type: 'rated',
    tmdbId: 1, movieTitle: 'X', moviePosterUrl: null, movieYear: '', mediaType: 'movie',
    rating: 8, likes: 0, likedBy: [],
    createdAt: new Date(2024, 0, 1),
  });
  // Bob blocks Carol → carol's post should be filtered out of bob's feed.
  await adminDb().collection('blocks').doc(`${bob.uid}_${carol.uid}`).set({
    blockerId: bob.uid, blockedId: carol.uid,
  });

  const bobToken = await bob.getIdToken();
  const res = await callRoute<{ items: unknown[]; hasMore: boolean }>(homeFeed, 'GET', {
    token: bobToken,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  // Feed is posts-only: alice's post shows; carol's post is block-filtered;
  // bob's `rated` activity is NOT in the feed (system activities excluded).
  assert.equal(res.body.data.items.length, 1);
  assert.equal((res.body.data.items[0] as { kind: string }).kind, 'post');
});

test('GET /home-feed: system activities (added/watched/rated) never appear', async () => {
  await adminDb().collection('activities').doc('a-added').set({
    id: 'a-added', userId: alice.uid, type: 'added',
    tmdbId: 1, movieTitle: 'X', moviePosterUrl: null, movieYear: '', mediaType: 'movie',
    likes: 0, likedBy: [], createdAt: new Date(),
  });
  await adminDb().collection('activities').doc('a-watched').set({
    id: 'a-watched', userId: alice.uid, type: 'watched',
    tmdbId: 1, movieTitle: 'X', moviePosterUrl: null, movieYear: '', mediaType: 'movie',
    likes: 0, likedBy: [], createdAt: new Date(),
  });
  await adminDb().collection('activities').doc('a-rated').set({
    id: 'a-rated', userId: alice.uid, type: 'rated',
    tmdbId: 1, movieTitle: 'X', moviePosterUrl: null, movieYear: '', mediaType: 'movie',
    rating: 8, likes: 0, likedBy: [], createdAt: new Date(),
  });

  const res = await callRoute<{ items: Array<{ kind: string; activity?: { type: string } }> }>(
    homeFeed, 'GET', {},
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  const activityTypes = res.body.data.items
    .filter((i) => i.kind === 'activity')
    .map((i) => i.activity!.type);
  // The reel is posts-only now — NO system activity appears, including `rated`.
  assert.deepEqual(activityTypes, [], 'no system activities appear in the home feed');
  assert.equal(res.body.data.items.length, 0, 'only activities were seeded → empty feed');
});
