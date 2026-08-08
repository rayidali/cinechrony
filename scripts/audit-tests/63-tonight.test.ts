/**
 * Phase D4 — the "what should we watch?" pool (`tonight-server.ts`).
 *
 * The hero puts a claim on the front page ("on 3 of your lists"), so the tests
 * are about that claim being TRUE, and about the pool never offering something
 * embarrassing:
 *
 *   · a watched film must never be suggested — the fastest way to make the
 *     hero feel like it isn't listening;
 *   · `listCount` must count lists the user actually chose, so the unfiled pen
 *     (a staging area, not a decision) contributes films but not credit;
 *   · a user with nothing gets an empty pool, not a broken hero.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { getTonightPool, invalidateTonightPool } from '@/lib/tonight-server';
import { createList } from '@/lib/lists-server';
import { addMovieToList } from '@/lib/movies-server';
import { ensureUnfiledList, UNFILED_LIST_ID } from '@/lib/unfiled-server';
import type { SearchResult } from '@/lib/types';

let user: TestUser;

const film = (id: number, title: string): SearchResult => ({
  id: String(id), title, year: '2023', posterUrl: 'https://x/p.jpg',
  posterHint: 'poster', mediaType: 'movie', tmdbId: id,
});

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  user = await createTestUser('t');
  await adminDb().collection('users').doc(user.uid).set({ uid: user.uid, username: 'tt' });
  invalidateTonightPool(user.uid);
});

const pool = async () => (await getTonightPool(user.uid)).films;

test('a watched film is never suggested', async () => {
  const { listId } = await createList(user.uid, 'seen it');
  await addMovieToList(user.uid, user.uid, listId, { movieData: film(1, 'dune'), status: 'Watched' });
  await addMovieToList(user.uid, user.uid, listId, { movieData: film(2, 'arrival'), status: 'To Watch' });
  invalidateTonightPool(user.uid);

  const films = await pool();
  assert.deepEqual(films.map((f) => f.title), ['arrival']);
});

test('listCount counts real lists, and the most-listed film leads', async () => {
  const a = await createList(user.uid, 'a24');
  const b = await createList(user.uid, 'date night');
  const c = await createList(user.uid, 'comfort');
  for (const l of [a, b, c]) {
    await addMovieToList(user.uid, user.uid, l.listId, { movieData: film(1, 'dune'), status: 'To Watch' });
  }
  await addMovieToList(user.uid, user.uid, a.listId, { movieData: film(2, 'arrival'), status: 'To Watch' });
  invalidateTonightPool(user.uid);

  const films = await pool();
  assert.equal(films[0].title, 'dune', 'most-listed leads');
  assert.equal(films[0].listCount, 3, 'the number the hero prints is the real one');
  assert.equal(films.find((f) => f.title === 'arrival')?.listCount, 1);
});

test('the unfiled pen contributes films but never credit', async () => {
  // A grabbed-but-unfiled film is the strongest signal of intent, so it belongs
  // in the pool — but "on 1 of your lists" would be a lie about a film the user
  // has not filed anywhere.
  await ensureUnfiledList(user.uid);
  await addMovieToList(user.uid, user.uid, UNFILED_LIST_ID, {
    movieData: film(3, 'past lives'), status: 'To Watch',
  });
  invalidateTonightPool(user.uid);

  const films = await pool();
  assert.equal(films.length, 1, 'still suggestible');
  assert.equal(films[0].title, 'past lives');
  assert.equal(films[0].listCount, 0, 'the pen is not a list you chose');
});

test('a film in both a real list and the pen is counted once, from the list', async () => {
  const { listId } = await createList(user.uid, 'a24');
  await ensureUnfiledList(user.uid);
  await addMovieToList(user.uid, user.uid, listId, { movieData: film(4, 'aftersun'), status: 'To Watch' });
  await addMovieToList(user.uid, user.uid, UNFILED_LIST_ID, { movieData: film(4, 'aftersun'), status: 'To Watch' });
  invalidateTonightPool(user.uid);

  const films = await pool();
  assert.equal(films.length, 1, 'one film, not two');
  assert.equal(films[0].listCount, 1);
});

test('a user with nothing gets an empty pool, not an error', async () => {
  // The hero renders nothing in this state — a new account sees the week strip
  // rather than an empty headline asking what to watch out of no films.
  assert.deepEqual(await pool(), []);
});

test('a freshly saved film can headline tonight', async () => {
  // NOTE ON WHAT IS *NOT* ASSERTED HERE. The pool is TTL-cached in production,
  // but `cachingDisabled()` returns true whenever FIRESTORE_EMULATOR_HOST is
  // set — every server-cache helper runs uncached under this harness, on
  // purpose, so tests see live data. A cache-HIT assertion would therefore be
  // asserting the harness, not the code, and would pass for the wrong reason.
  // What matters and is testable: the loader itself always reflects reality,
  // so an invalidation in prod can only ever reveal the truth.
  const { listId } = await createList(user.uid, 'a24');
  await addMovieToList(user.uid, user.uid, listId, { movieData: film(5, 'tar'), status: 'To Watch' });
  assert.equal((await pool()).length, 1);

  await addMovieToList(user.uid, user.uid, listId, { movieData: film(6, 'the whale'), status: 'To Watch' });
  assert.equal((await pool()).length, 2, 'a film saved this morning can be tonight’s suggestion');

  // The invalidation hook is what the write paths call; it must at least exist
  // and be safe to call for a user with no cached entry.
  invalidateTonightPool(user.uid);
  invalidateTonightPool('nobody');
  assert.equal((await pool()).length, 2);
});
