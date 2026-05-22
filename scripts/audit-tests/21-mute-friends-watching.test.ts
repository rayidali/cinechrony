/**
 * Phase 6 — mute + friends-watching.
 *
 * muteUser / unmuteUser / getMyMutes and getFriendsWatching (aggregates a film
 * 2+ followed users have touched into one card).
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let muteUser: (idToken: unknown, mutedId: string) => Promise<any>;
let unmuteUser: (idToken: unknown, mutedId: string) => Promise<any>;
let getMyMutes: (idToken: unknown) => Promise<any>;
let getFriendsWatching: (idToken: unknown) => Promise<any>;
let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ muteUser, unmuteUser, getMyMutes, getFriendsWatching } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('mute → getMyMutes lists the user; unmute clears it', async () => {
  await callActionAs(alice, muteUser, 'bob-uid');
  let mutes = await callActionAs(alice, getMyMutes);
  assert.deepEqual(mutes.mutedIds, ['bob-uid']);

  await callActionAs(alice, unmuteUser, 'bob-uid');
  mutes = await callActionAs(alice, getMyMutes);
  assert.deepEqual(mutes.mutedIds, []);
});

test('a user cannot mute themselves', async () => {
  const res = await callActionAs(alice, muteUser, alice.uid);
  assert.deepEqual(res, { error: 'Invalid user.' });
});

test('a forged token cannot mute', async () => {
  const res = await callActionWithRawToken('', muteUser, 'bob-uid');
  assert.ok('error' in res);
});

test('getFriendsWatching aggregates a film 2+ followed users touched', async () => {
  // alice follows bob + carol
  await adminDb().collection('users').doc(alice.uid).collection('following').doc('bob').set({});
  await adminDb().collection('users').doc(alice.uid).collection('following').doc('carol').set({});

  const act = (userId: string, tmdbId: number, rating: number) =>
    adminDb().collection('activities').add({
      userId, type: 'rated', tmdbId, rating,
      movieTitle: `film ${tmdbId}`, moviePosterUrl: null, movieYear: '2024',
      mediaType: 'movie', likes: 0, likedBy: [], createdAt: new Date(),
    });

  await act('bob', 100, 8);
  await act('carol', 100, 9);  // film 100 — two friends → a card
  await act('bob', 200, 7);    // film 200 — one friend → no card

  const res = await callActionAs(alice, getFriendsWatching);
  assert.equal(res.cards.length, 1);
  assert.equal(res.cards[0].tmdbId, 100);
  assert.equal(res.cards[0].friends.length, 2);
  assert.equal(res.cards[0].avgRating, 8.5);
});

test('getFriendsWatching is empty when the viewer follows nobody', async () => {
  const res = await callActionAs(alice, getFriendsWatching);
  assert.deepEqual(res.cards, []);
});
