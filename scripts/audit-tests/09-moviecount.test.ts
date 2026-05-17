/**
 * Phase 2.2 — movieCount integrity (atomicity + concurrency).
 *
 * Pre-fix bugs:
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

let addMovieToList: (fd: FormData) => Promise<any>;
let removeMovieFromList: (idToken: unknown, listOwnerId: string, listId: string, movieId: string) => Promise<any>;
let owner: TestUser;

before(async () => {
  setupTestEnv();
  ({ addMovieToList, removeMovieFromList } = await import('@/app/actions'));
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

function addFd(token: string, movieId: string) {
  const f = new FormData();
  f.append('idToken', token);
  f.append('listId', 'L1');
  f.append('listOwnerId', owner.uid);
  f.append('movieData', JSON.stringify({ id: movieId, title: `M${movieId}`, year: '2020', posterUrl: '', mediaType: 'movie' }));
  return f;
}

test('add: a single new movie increments movieCount by exactly 1', async () => {
  const tok = await owner.getIdToken();
  const res = await addMovieToList(addFd(tok, '111'));
  assert.ok(!('error' in res), `add failed: ${JSON.stringify(res)}`);
  assert.equal(await moviesCount(), 1, 'one movie doc');
  assert.equal(await storedCount(), 1, 'movieCount == 1');
});

test('add: concurrent adds of the SAME movie → movieCount is 1, not 2 (race fixed)', async () => {
  const tok = await owner.getIdToken();
  await Promise.all([
    addMovieToList(addFd(tok, '222')),
    addMovieToList(addFd(tok, '222')),
  ]);
  assert.equal(await moviesCount(), 1, 'still one movie doc (merge)');
  assert.equal(await storedCount(), 1, 'movieCount did NOT double-count');
});

test('add: re-adding an existing movie does NOT increment again', async () => {
  const tok = await owner.getIdToken();
  await addMovieToList(addFd(tok, '333'));
  await addMovieToList(addFd(tok, '333'));
  assert.equal(await storedCount(), 1, 'second add of same movie is a no-op for the count');
});

test('remove: deleting an existing movie decrements by exactly 1', async () => {
  await listRef().collection('movies').doc('movie_999').set({ id: 'movie_999', title: 'X' });
  await listRef().update({ movieCount: 1 });

  const res = await removeMovieFromList(await owner.getIdToken(), owner.uid, 'L1', 'movie_999');
  assert.ok(!('error' in res), JSON.stringify(res));
  assert.equal(await storedCount(), 0, 'movieCount back to 0');
  assert.equal(await moviesCount(), 0, 'movie doc gone');
});

test('remove: removing an already-gone movie does NOT decrement (no negative drift)', async () => {
  await listRef().update({ movieCount: 0 });
  const tok = await owner.getIdToken();

  // Movie 'ghost' never existed.
  const res = await removeMovieFromList(tok, owner.uid, 'L1', 'ghost');
  assert.ok(!('error' in res), JSON.stringify(res));
  assert.equal(await storedCount(), 0, 'count stayed at 0 — did NOT go to -1');
});

test('remove: concurrent double-remove of the same movie decrements only once', async () => {
  await listRef().collection('movies').doc('m').set({ id: 'm', title: 'X' });
  await listRef().update({ movieCount: 1 });
  const tok = await owner.getIdToken();

  await Promise.all([
    removeMovieFromList(tok, owner.uid, 'L1', 'm'),
    removeMovieFromList(tok, owner.uid, 'L1', 'm'),
  ]);
  assert.equal(await storedCount(), 0, 'exactly one decrement, not two (no drift to -1)');
});
