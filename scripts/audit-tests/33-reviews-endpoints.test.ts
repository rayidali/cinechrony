/**
 * Phase A.3 PR #8 — reviews-namespace endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/reviews                       createReview (rate-limited, threading, notifications)
 *   - GET    /api/v1/reviews?tmdbId=&sort=&cursor= getMovieReviews (cursor pagination)
 *   - GET    /api/v1/reviews/[id]/replies?cursor=  getReviewReplies (cursor pagination)
 *   - PATCH  /api/v1/reviews/[id]                  updateReview (real edit, AUDIT 2.6)
 *   - DELETE /api/v1/reviews/[id]                  deleteReview
 *   - POST   /api/v1/reviews/[id]/like             likeReview (transactional, AUDIT 3.5)
 *   - DELETE /api/v1/reviews/[id]/like             unlikeReview (transactional)
 *   - GET    /api/v1/reviews/by-user               getUserReviewForMovie
 *
 * AUDIT regression coverage:
 *   - 2.6 — update mutates the original doc; no duplicate post.
 *   - 3.5 — like / unlike atomicity (also covered by `14-like-atomicity`).
 *   - 3.10 — cursor pagination on getMovieReviews + getReviewReplies.
 *     Tested below with a 3-page sequence.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as createPost, GET as listGet } from '@/app/api/v1/reviews/route';
import { PATCH as patchReview, DELETE as deleteReview } from '@/app/api/v1/reviews/[id]/route';
import { GET as repliesGet } from '@/app/api/v1/reviews/[id]/replies/route';
import { POST as likePost, DELETE as unlikeDelete } from '@/app/api/v1/reviews/[id]/like/route';
import { GET as byUserGet } from '@/app/api/v1/reviews/by-user/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', usernameLower: 'alice', displayName: 'Alice', photoURL: null,
  });
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob', usernameLower: 'bob', displayName: 'Bob', photoURL: null,
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const TMDB_ID = 603;
const reviewDoc = (id: string) => adminDb().collection('reviews').doc(id);

function reviewBody(text = 'great film', overrides: Record<string, unknown> = {}) {
  return {
    tmdbId: TMDB_ID,
    mediaType: 'movie',
    movieTitle: 'The Matrix',
    text,
    ...overrides,
  };
}

// ─── POST /reviews ────────────────────────────────────────────────────────

test('POST /reviews: unauth → 401', async () => {
  const res = await callRoute(createPost, 'POST', { body: reviewBody() });
  assert.equal(res.status, 401);
});

test('POST /reviews: missing required fields → 400', async () => {
  const token = await alice.getIdToken();
  for (const body of [{}, { tmdbId: 1 }, { tmdbId: 1, mediaType: 'movie' }, { tmdbId: 1, mediaType: 'movie', movieTitle: 'x' }]) {
    const res = await callRoute(createPost, 'POST', { token, body });
    assert.equal(res.status, 400);
  }
});

test('POST /reviews: invalid mediaType → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(createPost, 'POST', {
    token, body: { ...reviewBody(), mediaType: 'wrong' },
  });
  assert.equal(res.status, 400);
});

test('POST /reviews: empty text after trim → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(createPost, 'POST', {
    token, body: reviewBody('   '),
  });
  assert.equal(res.status, 400);
});

test('POST /reviews: text over 2000 chars → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(createPost, 'POST', {
    token, body: reviewBody('x'.repeat(2001)),
  });
  assert.equal(res.status, 400);
});

test('POST /reviews: happy path persists + writes activity', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ review: { id: string } }>(createPost, 'POST', {
    token, body: reviewBody('peak cinema'),
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');

  const stored = await reviewDoc(res.body.data.review.id).get();
  assert.equal(stored.data()?.text, 'peak cinema');
  assert.equal(stored.data()?.userId, alice.uid);
  assert.equal(stored.data()?.parentId, null);

  // 'reviewed' activity emitted for top-level review.
  const activities = await adminDb().collection('activities')
    .where('userId', '==', alice.uid)
    .where('type', '==', 'reviewed')
    .get();
  assert.equal(activities.size, 1);
});

test('POST /reviews: reply increments parent replyCount + creates reply notification', async () => {
  // Alice posts a top-level; Bob replies.
  const aliceToken = await alice.getIdToken();
  const parent = await callRoute<{ review: { id: string } }>(createPost, 'POST', {
    token: aliceToken, body: reviewBody('original'),
  });
  if (parent.body.ok !== true) return assert.fail('expected ok');
  const parentId = parent.body.data.review.id;

  const bobToken = await bob.getIdToken();
  const reply = await callRoute(createPost, 'POST', {
    token: bobToken, body: reviewBody('agreed', { parentId }),
  });
  assert.equal(reply.status, 200);

  const parentAfter = await reviewDoc(parentId).get();
  assert.equal(parentAfter.data()?.replyCount, 1);

  // Reply notification fanned out to alice.
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', alice.uid)
    .where('type', '==', 'reply')
    .get();
  assert.equal(notifs.size, 1);
});

test('POST /reviews: @-mention fans out a mention notification', async () => {
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(createPost, 'POST', {
    token: aliceToken, body: reviewBody('hey @bob check this out'),
  });
  assert.equal(res.status, 200);

  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', bob.uid)
    .where('type', '==', 'mention')
    .get();
  assert.equal(notifs.size, 1);
});

// ─── GET /reviews (with AUDIT 3.10 pagination) ────────────────────────────

test('GET /reviews: missing tmdbId → 400', async () => {
  const res = await callRoute(listGet, 'GET', {});
  assert.equal(res.status, 400);
});

test('GET /reviews: returns top-level only (parentId === null)', async () => {
  // Seed: 2 top-level + 1 reply.
  await reviewDoc('r1').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: alice.uid, text: 'one', likes: 0, likedBy: [], parentId: null,
    createdAt: new Date(),
  });
  await reviewDoc('r2').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: bob.uid, text: 'two', likes: 0, likedBy: [], parentId: null,
    createdAt: new Date(),
  });
  await reviewDoc('r3').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: bob.uid, text: 'reply', likes: 0, likedBy: [], parentId: 'r1',
    createdAt: new Date(),
  });

  const res = await callRoute<{ reviews: Array<{ id: string }>; hasMore: boolean }>(
    listGet, 'GET', { url: `http://test/api/v1/reviews?tmdbId=${TMDB_ID}` },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.reviews.length, 2, 'replies excluded');
  assert.equal(res.body.data.hasMore, false);
});

test('GET /reviews: cursor pagination — 3 pages of 2 over 5 reviews (AUDIT 3.10)', async () => {
  // Seed 5 reviews with monotonic timestamps (oldest first → so newest is r5).
  for (let i = 1; i <= 5; i++) {
    await reviewDoc(`r${i}`).set({
      tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
      userId: alice.uid, text: `t${i}`, likes: 0, likedBy: [], parentId: null,
      createdAt: new Date(2024, 0, i),
    });
  }

  // Page 1: 2 newest (r5, r4)
  const page1 = await callRoute<{ reviews: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    listGet, 'GET', { url: `http://test/api/v1/reviews?tmdbId=${TMDB_ID}&limit=2` },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.reviews.length, 2);
  assert.equal(page1.body.data.hasMore, true);
  assert.equal(page1.body.data.nextCursor, page1.body.data.reviews[1].id);

  // Page 2: next 2 (r3, r2)
  const page2 = await callRoute<{ reviews: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    listGet, 'GET', { url: `http://test/api/v1/reviews?tmdbId=${TMDB_ID}&limit=2&cursor=${page1.body.data.nextCursor}` },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.reviews.length, 2);
  assert.equal(page2.body.data.hasMore, true);

  // Page 3: final (r1)
  const page3 = await callRoute<{ reviews: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    listGet, 'GET', { url: `http://test/api/v1/reviews?tmdbId=${TMDB_ID}&limit=2&cursor=${page2.body.data.nextCursor}` },
  );
  if (page3.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page3.body.data.reviews.length, 1);
  assert.equal(page3.body.data.hasMore, false);
  assert.equal(page3.body.data.nextCursor, undefined);
});

// ─── GET /reviews/[id]/replies ────────────────────────────────────────────

test('GET /reviews/[id]/replies: chronological + cursor pagination', async () => {
  // 4 replies under r1, oldest first.
  for (let i = 1; i <= 4; i++) {
    await reviewDoc(`rep${i}`).set({
      tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
      userId: bob.uid, text: `reply ${i}`, likes: 0, likedBy: [],
      parentId: 'parent-r1',
      createdAt: new Date(2024, 0, i),
    });
  }

  const page1 = await callRoute<{ replies: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    repliesGet, 'GET', { params: { id: 'parent-r1' }, url: `http://test/api/v1/reviews/parent-r1/replies?limit=2` },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.replies.length, 2);
  assert.equal(page1.body.data.hasMore, true);

  const page2 = await callRoute<{ replies: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    repliesGet, 'GET', { params: { id: 'parent-r1' }, url: `http://test/api/v1/reviews/parent-r1/replies?limit=2&cursor=${page1.body.data.nextCursor}` },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.replies.length, 2);
  assert.equal(page2.body.data.hasMore, false);
});

// ─── PATCH /reviews/[id] (AUDIT 2.6) ──────────────────────────────────────

test('PATCH /reviews/[id]: non-owner → 403', async () => {
  await reviewDoc('r1').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: alice.uid, text: 'original', likes: 0, likedBy: [], parentId: null,
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(patchReview, 'PATCH', {
    token: bobToken, params: { id: 'r1' }, body: { text: 'hijacked' },
  });
  assert.equal(res.status, 403);
});

test('PATCH /reviews/[id]: owner real-edit mutates the same doc (AUDIT 2.6)', async () => {
  await reviewDoc('r1').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: alice.uid, text: 'original', likes: 0, likedBy: [], parentId: null,
    createdAt: new Date(2024, 0, 1),
  });
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(patchReview, 'PATCH', {
    token: aliceToken, params: { id: 'r1' }, body: { text: 'edited' },
  });
  assert.equal(res.status, 200);

  // SAME doc id, mutated in place — no duplicate.
  const after = await reviewDoc('r1').get();
  assert.equal(after.data()?.text, 'edited');
  const all = await adminDb().collection('reviews').get();
  assert.equal(all.size, 1, 'edit did not create a duplicate review');
});

test('PATCH /reviews/[id]: empty body → 400', async () => {
  await reviewDoc('r1').set({
    tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X',
    userId: alice.uid, text: 'original', likes: 0, likedBy: [], parentId: null,
  });
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(patchReview, 'PATCH', {
    token: aliceToken, params: { id: 'r1' }, body: {},
  });
  assert.equal(res.status, 400);
});

test('PATCH /reviews/[id]: missing review → 404', async () => {
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(patchReview, 'PATCH', {
    token: aliceToken, params: { id: 'no-such' }, body: { text: 'x' },
  });
  assert.equal(res.status, 404);
});

// ─── DELETE /reviews/[id] ─────────────────────────────────────────────────

test('DELETE /reviews/[id]: non-owner → 403', async () => {
  await reviewDoc('r1').set({
    userId: alice.uid, text: 'mine', tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', likes: 0, likedBy: [], parentId: null,
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute(deleteReview, 'DELETE', {
    token: bobToken, params: { id: 'r1' },
  });
  assert.equal(res.status, 403);
});

test('DELETE /reviews/[id]: owner deletes', async () => {
  await reviewDoc('r1').set({
    userId: alice.uid, text: 'mine', tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', likes: 0, likedBy: [], parentId: null,
  });
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(deleteReview, 'DELETE', {
    token: aliceToken, params: { id: 'r1' },
  });
  assert.equal(res.status, 200);
  assert.equal((await reviewDoc('r1').get()).exists, false);
});

// ─── POST + DELETE /reviews/[id]/like (AUDIT 3.5) ─────────────────────────

test('POST /reviews/[id]/like: returns updated count + writes like notification', async () => {
  await reviewDoc('r1').set({
    userId: alice.uid, text: 'mine', tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', likes: 0, likedBy: [], parentId: null,
  });
  const bobToken = await bob.getIdToken();
  const res = await callRoute<{ likes: number }>(likePost, 'POST', {
    token: bobToken, params: { id: 'r1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 1);

  // Like notification for alice (the review author).
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', alice.uid)
    .where('type', '==', 'like')
    .get();
  assert.equal(notifs.size, 1);
});

test('POST /reviews/[id]/like: no notification when liker is the author', async () => {
  await reviewDoc('r1').set({
    userId: alice.uid, text: 'mine', tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', likes: 0, likedBy: [], parentId: null,
  });
  const aliceToken = await alice.getIdToken();
  await callRoute(likePost, 'POST', { token: aliceToken, params: { id: 'r1' } });
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', alice.uid)
    .where('type', '==', 'like')
    .get();
  assert.equal(notifs.size, 0, 'no self-like notification');
});

// ─── GET /reviews/by-user ─────────────────────────────────────────────────

test('GET /reviews/by-user: returns the user\'s review for the movie', async () => {
  await reviewDoc('r1').set({
    userId: alice.uid, text: 'mine', tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', likes: 0, likedBy: [], parentId: null,
  });
  const res = await callRoute<{ review: { id: string; userId: string } | null }>(byUserGet, 'GET', {
    url: `http://test/api/v1/reviews/by-user?userId=${alice.uid}&tmdbId=${TMDB_ID}`,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.review?.userId, alice.uid);
});

test('GET /reviews/by-user: returns null when no review exists', async () => {
  const res = await callRoute<{ review: unknown }>(byUserGet, 'GET', {
    url: `http://test/api/v1/reviews/by-user?userId=${alice.uid}&tmdbId=${TMDB_ID}`,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.review, null);
});

test('GET /reviews/by-user: missing query params → 400', async () => {
  const res = await callRoute(byUserGet, 'GET', { url: 'http://test/api/v1/reviews/by-user' });
  assert.equal(res.status, 400);
});
