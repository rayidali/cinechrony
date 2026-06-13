/**
 * Phase A.3 PR #10 — activities-namespace endpoint tests.
 *
 * Covers:
 *   - GET    /api/v1/activities?limit=&cursor=    getActivityFeed (cursor pagination)
 *   - POST   /api/v1/activities/[id]/like         likeActivity (transactional, AUDIT 3.5)
 *   - DELETE /api/v1/activities/[id]/like         unlikeActivity (transactional)
 *
 * Closes AUDIT 3.5 for the third like-target surface (the first two —
 * `reviews` and `lists` — landed in PRs #8 and #9 respectively). Same
 * read-check-write-in-runTransaction pattern.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as feedGet } from '@/app/api/v1/activities/route';
import { POST as likePost, DELETE as unlikeDelete }
  from '@/app/api/v1/activities/[id]/like/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function seedActivity(id: string, opts: { userId?: string; createdAt?: Date } = {}) {
  await adminDb().collection('activities').doc(id).set({
    id,
    userId: opts.userId ?? alice.uid,
    username: 'alice',
    type: 'rated',
    tmdbId: 1,
    movieTitle: 'X',
    moviePosterUrl: null,
    movieYear: '2024',
    mediaType: 'movie',
    rating: 8,
    likes: 0,
    likedBy: [],
    createdAt: opts.createdAt ?? new Date(),
  });
}

// ─── GET /activities ──────────────────────────────────────────────────────

test('GET /activities: public — no auth required', async () => {
  await seedActivity('a1');
  const res = await callRoute<{ activities: unknown[] }>(feedGet, 'GET', {});
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.activities.length, 1);
});

test('GET /activities: cursor pagination — 3 pages of 2 over 5 activities', async () => {
  for (let i = 1; i <= 5; i++) {
    await seedActivity(`a${i}`, { createdAt: new Date(2024, 0, i) });
  }

  const page1 = await callRoute<{ activities: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    feedGet, 'GET', { url: 'http://test/api/v1/activities?limit=2' },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.activities.length, 2);
  assert.equal(page1.body.data.hasMore, true);
  assert.equal(page1.body.data.nextCursor, page1.body.data.activities[1].id);

  const page2 = await callRoute<{ activities: unknown[]; hasMore: boolean; nextCursor?: string }>(
    feedGet, 'GET', { url: `http://test/api/v1/activities?limit=2&cursor=${page1.body.data.nextCursor}` },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.activities.length, 2);
  assert.equal(page2.body.data.hasMore, true);

  const page3 = await callRoute<{ activities: unknown[]; hasMore: boolean }>(
    feedGet, 'GET', { url: `http://test/api/v1/activities?limit=2&cursor=${page2.body.data.nextCursor}` },
  );
  if (page3.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page3.body.data.activities.length, 1);
  assert.equal(page3.body.data.hasMore, false);
});

// ─── POST /activities/[id]/like ───────────────────────────────────────────

test('POST /activities/[id]/like: unauth → 401', async () => {
  await seedActivity('a1');
  const res = await callRoute(likePost, 'POST', { params: { id: 'a1' } });
  assert.equal(res.status, 401);
});

test('POST /activities/[id]/like: missing activity → 404', async () => {
  const token = await bob.getIdToken();
  const res = await callRoute(likePost, 'POST', {
    token, params: { id: 'nope' },
  });
  assert.equal(res.status, 404);
});

test('POST /activities/[id]/like: happy path increments + returns count', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  const res = await callRoute<{ likes: number }>(likePost, 'POST', {
    token, params: { id: 'a1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 1);

  const after = (await adminDb().collection('activities').doc('a1').get()).data();
  assert.equal(after?.likes, 1);
  assert.deepEqual(after?.likedBy, [bob.uid]);
});

test('POST /activities/[id]/like: already-liked → 409', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  await callRoute(likePost, 'POST', { token, params: { id: 'a1' } });
  const dup = await callRoute(likePost, 'POST', { token, params: { id: 'a1' } });
  assert.equal(dup.status, 409);
});

test('POST /activities/[id]/like: concurrent double-like → exactly one increment (AUDIT 3.5)', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  const results = await Promise.allSettled([
    callRoute(likePost, 'POST', { token, params: { id: 'a1' } }),
    callRoute(likePost, 'POST', { token, params: { id: 'a1' } }),
  ]);
  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort();
  assert.deepEqual(statuses, [200, 409], 'one success, one already-liked');

  const after = (await adminDb().collection('activities').doc('a1').get()).data();
  assert.equal(after?.likes, 1, 'no double-increment');
  assert.equal((after?.likedBy as string[]).length, 1);
});

// ─── DELETE /activities/[id]/like ─────────────────────────────────────────

test('DELETE /activities/[id]/like: not-liked → 409', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  const res = await callRoute(unlikeDelete, 'DELETE', {
    token, params: { id: 'a1' },
  });
  assert.equal(res.status, 409);
});

test('DELETE /activities/[id]/like: drops like + decrements', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  await callRoute(likePost, 'POST', { token, params: { id: 'a1' } });

  const res = await callRoute<{ likes: number }>(unlikeDelete, 'DELETE', {
    token, params: { id: 'a1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 0);

  const after = (await adminDb().collection('activities').doc('a1').get()).data();
  assert.equal(after?.likes, 0);
  assert.deepEqual(after?.likedBy, []);
});

test('DELETE /activities/[id]/like: concurrent double-unlike → exactly one decrement', async () => {
  await seedActivity('a1');
  const token = await bob.getIdToken();
  await callRoute(likePost, 'POST', { token, params: { id: 'a1' } });

  await Promise.all([
    callRoute(unlikeDelete, 'DELETE', { token, params: { id: 'a1' } }),
    callRoute(unlikeDelete, 'DELETE', { token, params: { id: 'a1' } }),
  ]);

  const after = (await adminDb().collection('activities').doc('a1').get()).data();
  assert.equal(after?.likes, 0, 'no drift to -1');
});
