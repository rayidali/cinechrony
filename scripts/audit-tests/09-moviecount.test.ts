/**
 * Phase 2.2 — movieCount integrity (atomicity + concurrency).
 *
 * Migrated to /api/v1 routes in Phase A PR #4. The transactional invariants
 * the legacy Server Actions enforced are preserved in `src/lib/movies-server.ts`
 * and exercised end-to-end through the route handlers here.
 *
 * Pre-fix bugs (still the regression we're protecting against):
 *  - add: set(movie) and increment(movieCount) were separate ops → a mid-op
 *    failure drifted the count; two concurrent adds of the SAME movie both
 *    read "not exists" and double-incremented.
 *  - remove: always increment(-1) even if the movie was already gone
 *    (double-tap / stale UI) → movieCount drifted negative.
 *
 * Fix: both wrapped in db.runTransaction (existence-check + write + count are
 * one unit; Firestore contention-retry collapses concurrent same-key races).
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as postMovie } from '@/app/api/v1/lists/[ownerId]/[listId]/movies/route';
import { DELETE as deleteMovie } from '@/app/api/v1/lists/[ownerId]/[listId]/movies/[movieId]/route';

let owner: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  await adminDb().collection('users').doc(owner.uid).set({ uid: owner.uid, username: 'owner' });
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [], isPublic: true, movieCount: 0 });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const listRef = () => adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1');
const moviesCount = async () =>
  (await listRef().collection('movies').count().get()).data().count;
const storedCount = async () => (await listRef().get()).data()?.movieCount;

async function callAdd(token: string, movieId: string) {
  return callRoute(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: 'L1' },
    body: {
      movieData: {
        id: movieId,
        title: `M${movieId}`,
        year: '2020',
        posterUrl: '',
        mediaType: 'movie',
      },
    },
  });
}

async function callRemove(token: string, movieId: string) {
  return callRoute(deleteMovie, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId: 'L1', movieId },
  });
}

test('add: a single new movie increments movieCount by exactly 1', async () => {
  const tok = await owner.getIdToken();
  const res = await callAdd(tok, '111');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(await moviesCount(), 1, 'one movie doc');
  assert.equal(await storedCount(), 1, 'movieCount == 1');
});

test('add: concurrent adds of the SAME movie → movieCount is 1, not 2 (race fixed)', async () => {
  const tok = await owner.getIdToken();
  await Promise.all([
    callAdd(tok, '222'),
    callAdd(tok, '222'),
  ]);
  assert.equal(await moviesCount(), 1, 'still one movie doc (merge)');
  assert.equal(await storedCount(), 1, 'movieCount did NOT double-count');
});

test('add: re-adding an existing movie does NOT increment again', async () => {
  const tok = await owner.getIdToken();
  await callAdd(tok, '333');
  await callAdd(tok, '333');
  assert.equal(await storedCount(), 1, 'second add of same movie is a no-op for the count');
});

test('remove: deleting an existing movie decrements by exactly 1', async () => {
  await listRef().collection('movies').doc('movie_999').set({ id: 'movie_999', title: 'X' });
  await listRef().update({ movieCount: 1 });

  const res = await callRemove(await owner.getIdToken(), 'movie_999');
  assert.equal(res.status, 200);
  assert.equal(await storedCount(), 0, 'movieCount back to 0');
  assert.equal(await moviesCount(), 0, 'movie doc gone');
});

test('remove: removing an already-gone movie does NOT decrement (no negative drift)', async () => {
  await listRef().update({ movieCount: 0 });
  const tok = await owner.getIdToken();

  // Movie 'ghost' never existed.
  const res = await callRemove(tok, 'ghost');
  assert.equal(res.status, 200);
  assert.equal(await storedCount(), 0, 'count stayed at 0 — did NOT go to -1');
});

test('remove: concurrent double-remove of the same movie decrements only once', async () => {
  await listRef().collection('movies').doc('m').set({ id: 'm', title: 'X' });
  await listRef().update({ movieCount: 1 });
  const tok = await owner.getIdToken();

  await Promise.all([
    callRemove(tok, 'm'),
    callRemove(tok, 'm'),
  ]);
  assert.equal(await storedCount(), 0, 'exactly one decrement, not two (no drift to -1)');
});
