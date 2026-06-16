/**
 * Phase A.3 PR #9 — ratings + list-likes endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/ratings                      createOrUpdateRating
 *   - GET    /api/v1/ratings/by-user?...          getUserRating
 *   - DELETE /api/v1/ratings/[tmdbId]             deleteRating
 *   - GET    /api/v1/users/[uid]/ratings?cursor=  getUserRatings (cursor pagination, AUDIT 2.5)
 *   - POST   /api/v1/lists/[ownerId]/[listId]/like   likeList (transactional, members-cant-like guard, AUDIT 3.5)
 *   - DELETE /api/v1/lists/[ownerId]/[listId]/like   unlikeList (transactional)
 *
 * The big-cap pagination test for AUDIT 2.5 lives in `13-ratings-pagination`
 * (migrated). This file covers the route-level happy paths + invariants.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as ratingPost } from '@/app/api/v1/ratings/route';
import { GET as ratingByUserGet } from '@/app/api/v1/ratings/by-user/route';
import { DELETE as ratingDelete } from '@/app/api/v1/ratings/[tmdbId]/route';
import { GET as userRatingsGet } from '@/app/api/v1/users/[uid]/ratings/route';
import { POST as listLikePost, DELETE as listUnlikeDelete }
  from '@/app/api/v1/lists/[ownerId]/[listId]/like/route';

let owner: TestUser, viewer: TestUser, collab: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  viewer = await createTestUser('viewer');
  collab = await createTestUser('collab');
});

after(async () => { await clearFirestore(); await clearAuth(); });

const TMDB_ID = 603;

// ─── POST /ratings ────────────────────────────────────────────────────────

test('POST /ratings: unauth → 401', async () => {
  const res = await callRoute(ratingPost, 'POST', {
    body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating: 8 },
  });
  assert.equal(res.status, 401);
});

test('POST /ratings: out-of-range (0 or 11) → 400', async () => {
  const token = await viewer.getIdToken();
  for (const rating of [0, 0.99, 10.01, 11, -1]) {
    const res = await callRoute(ratingPost, 'POST', {
      token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating },
    });
    assert.equal(res.status, 400, `rating ${rating} should reject`);
  }
});

test('POST /ratings: happy path creates with deterministic doc id + emits activity', async () => {
  const token = await viewer.getIdToken();
  const res = await callRoute<{ rating: { rating: number }; isNew: boolean }>(ratingPost, 'POST', {
    token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'The Matrix', rating: 9 },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.isNew, true);
  assert.equal(res.body.data.rating.rating, 9);

  // Doc id is `${uid}_${tmdbId}`.
  const stored = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.equal(stored.data()?.userId, viewer.uid);

  // 'rated' activity emitted on first rating.
  const activities = await adminDb().collection('activities')
    .where('userId', '==', viewer.uid)
    .where('type', '==', 'rated')
    .get();
  assert.equal(activities.size, 1);
});

test('POST /ratings: re-rate mutates same doc + does NOT re-emit activity (isNew=false)', async () => {
  const token = await viewer.getIdToken();
  await callRoute(ratingPost, 'POST', {
    token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating: 7 },
  });
  const res2 = await callRoute<{ isNew: boolean }>(ratingPost, 'POST', {
    token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating: 9 },
  });
  if (res2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res2.body.data.isNew, false);

  // Same doc, updated value.
  const stored = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.equal(stored.data()?.rating, 9);

  // Still exactly one activity (no spam on re-rate).
  const activities = await adminDb().collection('activities')
    .where('userId', '==', viewer.uid)
    .where('type', '==', 'rated')
    .get();
  assert.equal(activities.size, 1, 're-rate does not duplicate activity');
});

test('POST /ratings: rounds to one decimal', async () => {
  const token = await viewer.getIdToken();
  await callRoute(ratingPost, 'POST', {
    token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating: 8.4567 },
  });
  const stored = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.equal(stored.data()?.rating, 8.5, 'rounded to nearest 0.1');
});

test('DELETE /ratings: clearing a rating also removes the "rated" activity', async () => {
  const token = await viewer.getIdToken();
  // First rating emits a 'rated' activity.
  await callRoute(ratingPost, 'POST', {
    token, body: { tmdbId: TMDB_ID, mediaType: 'movie', movieTitle: 'X', rating: 8 },
  });
  let acts = await adminDb().collection('activities')
    .where('userId', '==', viewer.uid).where('type', '==', 'rated').get();
  assert.equal(acts.size, 1, "the rating emitted a 'rated' activity");

  // Clearing it should remove that activity (so it leaves profile "recent").
  const del = await callRoute(ratingDelete, 'DELETE', { token, params: { tmdbId: String(TMDB_ID) } });
  assert.equal(del.status, 200);
  acts = await adminDb().collection('activities')
    .where('userId', '==', viewer.uid).where('type', '==', 'rated').get();
  assert.equal(acts.size, 0, "the 'rated' activity is gone after clearing");
});

// ─── GET /ratings/by-user ─────────────────────────────────────────────────

test('GET /ratings/by-user: returns the rating', async () => {
  await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).set({
    userId: viewer.uid, tmdbId: TMDB_ID, mediaType: 'movie',
    movieTitle: 'X', rating: 8,
  });
  const res = await callRoute<{ rating: { rating: number } | null }>(ratingByUserGet, 'GET', {
    url: `http://test/api/v1/ratings/by-user?userId=${viewer.uid}&tmdbId=${TMDB_ID}`,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.rating?.rating, 8);
});

test('GET /ratings/by-user: returns null when missing', async () => {
  const res = await callRoute<{ rating: unknown }>(ratingByUserGet, 'GET', {
    url: `http://test/api/v1/ratings/by-user?userId=${viewer.uid}&tmdbId=${TMDB_ID}`,
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.rating, null);
});

test('GET /ratings/by-user: missing params → 400', async () => {
  const res = await callRoute(ratingByUserGet, 'GET', { url: 'http://test/api/v1/ratings/by-user' });
  assert.equal(res.status, 400);
});

// ─── DELETE /ratings/[tmdbId] ─────────────────────────────────────────────

test('DELETE /ratings/[tmdbId]: deletes own rating', async () => {
  await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).set({
    userId: viewer.uid, tmdbId: TMDB_ID, rating: 8,
  });
  const token = await viewer.getIdToken();
  const res = await callRoute(ratingDelete, 'DELETE', {
    token, params: { tmdbId: String(TMDB_ID) },
  });
  assert.equal(res.status, 200);
  assert.equal((await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get()).exists, false);
});

test('DELETE /ratings/[tmdbId]: missing rating → 404', async () => {
  const token = await viewer.getIdToken();
  const res = await callRoute(ratingDelete, 'DELETE', {
    token, params: { tmdbId: String(TMDB_ID) },
  });
  assert.equal(res.status, 404);
});

test('DELETE /ratings/[tmdbId]: non-numeric tmdbId → 400', async () => {
  const token = await viewer.getIdToken();
  const res = await callRoute(ratingDelete, 'DELETE', {
    token, params: { tmdbId: 'abc' },
  });
  assert.equal(res.status, 400);
});

// ─── GET /users/[uid]/ratings ─────────────────────────────────────────────

test('GET /users/[uid]/ratings: hasMore + nextCursor advance correctly', async () => {
  // Seed 5 ratings.
  for (let i = 1; i <= 5; i++) {
    await adminDb().collection('ratings').doc(`${viewer.uid}_${i}`).set({
      userId: viewer.uid, tmdbId: i, mediaType: 'movie',
      movieTitle: `M${i}`, rating: i,
      createdAt: new Date(2024, 0, i),
      updatedAt: new Date(2024, 0, i),
    });
  }

  const page1 = await callRoute<{ ratings: unknown[]; hasMore: boolean; nextCursor?: string }>(
    userRatingsGet, 'GET', {
      params: { uid: viewer.uid },
      url: `http://test/api/v1/users/${viewer.uid}/ratings?limit=2`,
    },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.ratings.length, 2);
  assert.equal(page1.body.data.hasMore, true);
  assert.ok(page1.body.data.nextCursor, 'cursor returned');

  const page2 = await callRoute<{ ratings: unknown[]; hasMore: boolean }>(
    userRatingsGet, 'GET', {
      params: { uid: viewer.uid },
      url: `http://test/api/v1/users/${viewer.uid}/ratings?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor!)}`,
    },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.ratings.length, 2);
  assert.equal(page2.body.data.hasMore, true);
});

// ─── POST /lists/[ownerId]/[listId]/like ──────────────────────────────────

async function seedPublicList(opts: { isPublic?: boolean; collaborators?: string[] } = {}) {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').set({
    id: 'L1', name: 'Public List', ownerId: owner.uid,
    isPublic: opts.isPublic ?? true,
    collaboratorIds: opts.collaborators ?? [],
    likes: 0, likedBy: [],
  });
}

test('POST /lists/.../like: unauth → 401', async () => {
  await seedPublicList();
  const res = await callRoute(listLikePost, 'POST', {
    params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 401);
});

test('POST /lists/.../like: private list → 403', async () => {
  await seedPublicList({ isPublic: false });
  const token = await viewer.getIdToken();
  const res = await callRoute(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 403);
});

test('POST /lists/.../like: owner cannot like own list → 403', async () => {
  await seedPublicList();
  const token = await owner.getIdToken();
  const res = await callRoute(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 403);
});

test('POST /lists/.../like: collaborator cannot like own list → 403 (anti-gaming)', async () => {
  await seedPublicList({ collaborators: [collab.uid] });
  const token = await collab.getIdToken();
  const res = await callRoute(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 403);
});

test('POST /lists/.../like: viewer likes successfully, count + notification', async () => {
  await seedPublicList();
  const token = await viewer.getIdToken();
  const res = await callRoute<{ likes: number }>(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 1);

  // Notification to owner.
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', owner.uid)
    .where('type', '==', 'list_like')
    .get();
  assert.equal(notifs.size, 1);
});

test('POST /lists/.../like: already-liked → 409', async () => {
  await seedPublicList();
  const token = await viewer.getIdToken();
  await callRoute(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  const dup = await callRoute(listLikePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(dup.status, 409);
});

test('POST /lists/.../like: concurrent double-like → exactly one increment (AUDIT 3.5)', async () => {
  await seedPublicList();
  const token = await viewer.getIdToken();
  const results = await Promise.allSettled([
    callRoute(listLikePost, 'POST', { token, params: { ownerId: owner.uid, listId: 'L1' } }),
    callRoute(listLikePost, 'POST', { token, params: { ownerId: owner.uid, listId: 'L1' } }),
  ]);
  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort();
  assert.deepEqual(statuses, [200, 409], 'one success, one already-liked');

  const list = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(list.data()?.likes, 1, 'no double-increment');
  assert.equal((list.data()?.likedBy as string[]).length, 1);
});

// ─── DELETE /lists/[ownerId]/[listId]/like ────────────────────────────────

test('DELETE /lists/.../like: removes own like and decrements', async () => {
  await seedPublicList();
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').update({
    likes: 1, likedBy: [viewer.uid],
  });
  const token = await viewer.getIdToken();
  const res = await callRoute<{ likes: number }>(listUnlikeDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 0);
});

test('DELETE /lists/.../like: not-liked → 409', async () => {
  await seedPublicList();
  const token = await viewer.getIdToken();
  const res = await callRoute(listUnlikeDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: 'L1' },
  });
  assert.equal(res.status, 409);
});
