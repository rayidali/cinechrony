/**
 * Phase 5 — saved / bookmark.
 *
 * saveItem / unsaveItem / getMyBookmarks / getSavedFeed. Asserts the deterministic
 * doc id, the saveable-type guard, auth rejection, and that getSavedFeed
 * re-hydrates saved activities and skips dangling (deleted) sources.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let saveItem: (idToken: unknown, t: string, id: string) => Promise<any>;
let unsaveItem: (idToken: unknown, t: string, id: string) => Promise<any>;
let getMyBookmarks: (idToken: unknown) => Promise<any>;
let getSavedFeed: (idToken: unknown, cursor?: string) => Promise<any>;
let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ saveItem, unsaveItem, getMyBookmarks, getSavedFeed } = await import('@/app/actions'));
});

async function seedActivity(id: string) {
  await adminDb().collection('activities').doc(id).set({
    userId: 'someone', type: 'rated', tmdbId: 1, movieTitle: `film ${id}`,
    moviePosterUrl: null, movieYear: '2024', mediaType: 'movie',
    likes: 0, likedBy: [], createdAt: new Date(),
  });
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('save an activity → it appears in getMyBookmarks', async () => {
  await seedActivity('A1');
  const res = await callActionAs(alice, saveItem, 'activity', 'A1');
  assert.equal(res.success, true);
  const marks = await callActionAs(alice, getMyBookmarks);
  assert.deepEqual(marks.keys, ['activity_A1']);
});

test('an invalid itemType is rejected', async () => {
  const res = await callActionAs(alice, saveItem, 'banana', 'X1');
  assert.deepEqual(res, { error: 'Invalid item.' });
});

test('unsave removes the bookmark', async () => {
  await seedActivity('A1');
  await callActionAs(alice, saveItem, 'activity', 'A1');
  await callActionAs(alice, unsaveItem, 'activity', 'A1');
  const marks = await callActionAs(alice, getMyBookmarks);
  assert.deepEqual(marks.keys, []);
});

test('getSavedFeed re-hydrates saved activities, newest-saved first', async () => {
  await seedActivity('A1');
  await seedActivity('A2');
  await callActionAs(alice, saveItem, 'activity', 'A1');
  await callActionAs(alice, saveItem, 'activity', 'A2'); // saved later → first
  const feed = await callActionAs(alice, getSavedFeed);
  assert.equal(feed.activities.length, 2);
  assert.equal(feed.activities[0].id, 'A2');
  assert.equal(feed.activities[1].id, 'A1');
});

test('getSavedFeed skips a dangling bookmark (deleted source)', async () => {
  await seedActivity('A1');
  await callActionAs(alice, saveItem, 'activity', 'A1');
  await adminDb().collection('activities').doc('A1').delete();
  const feed = await callActionAs(alice, getSavedFeed);
  assert.deepEqual(feed.activities, []);
});

test('a forged token cannot save', async () => {
  await seedActivity('A1');
  const res = await callActionWithRawToken('', saveItem, 'activity', 'A1');
  assert.ok('error' in res);
});
