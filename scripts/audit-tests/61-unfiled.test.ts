/**
 * Phase D2 — the unfiled pen (`unfiled-server.ts`).
 *
 * The point of this feature is that a grab no longer stops to ask for a list,
 * so the tests are ordered around the two ways that could go wrong:
 *
 *   1. THE PEN LEAKS. It is a real list doc, so every surface that enumerates
 *      lists could show it as a stray "unfiled" list — the lists grid, the
 *      add-to-list sheet, a public profile. Each is asserted separately,
 *      because each is a different query and they do not fail together.
 *   2. FILING LOSES A FILM. The pen is the ONLY record that something was
 *      grabbed. `fileUnfiled` therefore adds to the destination BEFORE
 *      removing from the pen; the failure tests below pin that order down.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import {
  ensureUnfiledList, fileUnfiled, clearUnfiled, isUnfiledList, UNFILED_LIST_ID,
} from '@/lib/unfiled-server';
import { getUserLists, getListsForMovie, getUserPublicLists, createList, deleteList } from '@/lib/lists-server';
import { addMovieToList } from '@/lib/movies-server';
import type { SearchResult } from '@/lib/types';

let user: TestUser, other: TestUser;

const FILM: SearchResult = {
  id: '670292', title: 'past lives', year: '2023',
  posterUrl: 'https://x/p.jpg', posterHint: 'poster', mediaType: 'movie', tmdbId: 670292,
};
const MOVIE_ID = 'movie_670292';

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  user = await createTestUser('owner');
  other = await createTestUser('other');
  await Promise.all([user, other].map((u) =>
    adminDb().collection('users').doc(u.uid).set({ uid: u.uid, username: u.uid.slice(0, 8) }),
  ));
});

/** Put a film in the pen the way the save path does. */
async function seedUnfiled(film: SearchResult = FILM, extra: Record<string, unknown> = {}) {
  await ensureUnfiledList(user.uid);
  await addMovieToList(user.uid, user.uid, UNFILED_LIST_ID, {
    movieData: film,
    socialLink: 'https://www.tiktok.com/@a/video/1',
    socialThumbnail: 'https://x/thumb.jpg',
    status: 'To Watch',
    ...extra,
  });
}

// ── provisioning ─────────────────────────────────────────────────────────

test('provisioning is idempotent under concurrency — a fixed id cannot race into two pens', async () => {
  // The whole reason the doc id is reserved rather than a Firestore auto-id.
  // A query-then-create would split a user's films across two pens here.
  const ids = await Promise.all(Array.from({ length: 5 }, () => ensureUnfiledList(user.uid)));
  assert.deepEqual([...new Set(ids)], [UNFILED_LIST_ID]);

  const lists = await adminDb().collection('users').doc(user.uid).collection('lists').get();
  assert.equal(lists.docs.filter((d) => isUnfiledList(d.data())).length, 1, 'exactly one pen');
});

test('a second ensure never resets movieCount on a pen that already holds films', async () => {
  await seedUnfiled();
  await ensureUnfiledList(user.uid);
  const doc = await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}`).get();
  assert.equal(doc.data()?.movieCount, 1, 'merge must not clobber the count back to 0');
});

// ── it must not leak ─────────────────────────────────────────────────────

test('the pen never appears in the lists grid', async () => {
  await createList(user.uid, 'a24 forever');
  await seedUnfiled();

  const { lists } = await getUserLists(user.uid);
  assert.equal(lists.length, 1, 'only the real list');
  assert.equal(lists[0].name, 'a24 forever');
  assert.ok(!lists.some((l) => l.id === UNFILED_LIST_ID));
});

test('the pen is never offered as a destination in the add-to-list sheet', async () => {
  await createList(user.uid, 'date night');
  await seedUnfiled();

  const { lists } = await getListsForMovie(user.uid, MOVIE_ID);
  assert.ok(!lists.some((l) => l.id === UNFILED_LIST_ID), 'filing into the pen is not a choice');
  assert.equal(lists.length, 1);
});

test('the pen never appears on a public profile', async () => {
  await seedUnfiled();
  const { lists } = await getUserPublicLists(user.uid);
  assert.equal(lists.length, 0, 'the pen is private and stays off public surfaces');
});

test('an ordinary list is never mistaken for the pen (the absent-field trap)', async () => {
  // `isUnfiled` is never backfilled, so every ordinary list LACKS the field. A
  // predicate written as an inequality would classify all of them as the pen
  // and empty the user's lists grid entirely.
  const { listId } = await createList(user.uid, 'comfort movies');
  const doc = await adminDb().doc(`users/${user.uid}/lists/${listId}`).get();
  assert.equal(doc.data()?.isUnfiled, undefined, 'the field really is absent');
  assert.equal(isUnfiledList(doc.data()), false);

  const { lists } = await getUserLists(user.uid);
  assert.equal(lists.length, 1, 'and it still shows up');
});

test('the pen cannot be deleted', async () => {
  await seedUnfiled();
  await assert.rejects(() => deleteList(user.uid, user.uid, UNFILED_LIST_ID));
  assert.ok((await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}`).get()).exists);
});

// ── filing ───────────────────────────────────────────────────────────────

test('filing moves the film and carries its clip with it', async () => {
  const { listId } = await createList(user.uid, 'a24 forever');
  await seedUnfiled();

  const res = await fileUnfiled(user.uid, [MOVIE_ID], { ownerId: user.uid, listId });
  assert.deepEqual(res.filed, [MOVIE_ID]);
  assert.deepEqual(res.failed, []);

  const moved = await adminDb().doc(`users/${user.uid}/lists/${listId}/movies/${MOVIE_ID}`).get();
  assert.ok(moved.exists, 'landed in the destination');
  assert.equal(moved.data()?.title, 'past lives');
  // D1's whole point: the clip is why the film is here. Losing it on a move
  // would quietly undo that.
  assert.equal(moved.data()?.socialLink, 'https://www.tiktok.com/@a/video/1');
  assert.equal(moved.data()?.socialThumbnail, 'https://x/thumb.jpg');

  const gone = await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}/movies/${MOVIE_ID}`).get();
  assert.ok(!gone.exists, 'left the pen');
});

test('filing keeps both movieCounts honest', async () => {
  const { listId } = await createList(user.uid, 'a24 forever');
  await seedUnfiled();
  await fileUnfiled(user.uid, [MOVIE_ID], { ownerId: user.uid, listId });

  const pen = await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}`).get();
  const dest = await adminDb().doc(`users/${user.uid}/lists/${listId}`).get();
  assert.equal(pen.data()?.movieCount, 0);
  assert.equal(dest.data()?.movieCount, 1);
});

test('filing into a brand-new list creates it and returns its id', async () => {
  await seedUnfiled();
  const res = await fileUnfiled(user.uid, [MOVIE_ID], { newListName: 'rainy sunday' });
  assert.deepEqual(res.filed, [MOVIE_ID]);

  const created = await adminDb().doc(`users/${user.uid}/lists/${res.listId}`).get();
  assert.equal(created.data()?.name, 'rainy sunday');
  assert.equal(isUnfiledList(created.data()), false, 'a normal list, not another pen');
});

test('a film is never lost when the destination refuses it', async () => {
  // The ordering guarantee. `other`'s list is not editable by `user`, so the
  // add throws — and the film must still be in the pen afterwards, because the
  // pen is the only record it was ever grabbed.
  const { listId } = await createList(other.uid, 'not yours');
  await seedUnfiled();

  const res = await fileUnfiled(user.uid, [MOVIE_ID], { ownerId: other.uid, listId });
  assert.deepEqual(res.filed, []);
  assert.equal(res.failed.length, 1);

  const still = await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}/movies/${MOVIE_ID}`).get();
  assert.ok(still.exists, 'a failed file loses nothing');
});

test('one bad film does not sink the rest of the batch', async () => {
  const { listId } = await createList(user.uid, 'a24 forever');
  await seedUnfiled();

  const res = await fileUnfiled(user.uid, [MOVIE_ID, 'movie_999999'], { ownerId: user.uid, listId });
  assert.deepEqual(res.filed, [MOVIE_ID]);
  assert.deepEqual(res.failed, [{ movieId: 'movie_999999', error: 'not_in_unfiled' }]);
});

test('filing the pen into itself is refused rather than deleting the film', async () => {
  // add-then-remove against the SAME doc would delete it. Caught up front.
  await seedUnfiled();
  await assert.rejects(
    () => fileUnfiled(user.uid, [MOVIE_ID], { ownerId: user.uid, listId: UNFILED_LIST_ID }),
  );
  assert.ok((await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}/movies/${MOVIE_ID}`).get()).exists);
});

test('re-filing an already-filed film dedupes instead of duplicating', async () => {
  const { listId } = await createList(user.uid, 'a24 forever');
  await addMovieToList(user.uid, user.uid, listId, { movieData: FILM, status: 'To Watch' });
  await seedUnfiled();

  const res = await fileUnfiled(user.uid, [MOVIE_ID], { ownerId: user.uid, listId });
  assert.deepEqual(res.filed, [MOVIE_ID]);
  const dest = await adminDb().doc(`users/${user.uid}/lists/${listId}`).get();
  assert.equal(dest.data()?.movieCount, 1, 'still one — the doc id is deterministic');
});

// ── clearing ─────────────────────────────────────────────────────────────

test('clear empties the pen', async () => {
  await seedUnfiled();
  await seedUnfiled({ ...FILM, id: '550', tmdbId: 550, title: 'fight club' });

  const res = await clearUnfiled(user.uid);
  assert.equal(res.removed, 2);
  const left = await adminDb().collection(`users/${user.uid}/lists/${UNFILED_LIST_ID}/movies`).get();
  assert.equal(left.size, 0);
  assert.equal((await adminDb().doc(`users/${user.uid}/lists/${UNFILED_LIST_ID}`).get()).data()?.movieCount, 0);
});

test('clear can drop just the films it is given', async () => {
  await seedUnfiled();
  await seedUnfiled({ ...FILM, id: '550', tmdbId: 550, title: 'fight club' });

  const res = await clearUnfiled(user.uid, [MOVIE_ID]);
  assert.equal(res.removed, 1);
  const left = await adminDb().collection(`users/${user.uid}/lists/${UNFILED_LIST_ID}/movies`).get();
  assert.deepEqual(left.docs.map((d) => d.id), ['movie_550']);
});
