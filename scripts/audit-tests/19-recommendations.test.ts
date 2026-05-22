/**
 * Phase 4 — recommendations.
 *
 * getSimilarMovies / getRecommendationsForUser. The TMDB-backed paths need the
 * network, so this covers the deterministic contract: input guards, auth
 * rejection, and the no-ratings short-circuit — none of which call TMDB.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let getSimilarMovies: (tmdbId: number, mediaType?: 'movie' | 'tv', limit?: number) => Promise<any>;
let getRecommendationsForUser: (idToken: unknown) => Promise<any>;
let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ getSimilarMovies, getRecommendationsForUser } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('getSimilarMovies guards an invalid tmdbId without throwing', async () => {
  const res = await getSimilarMovies(0, 'movie');
  assert.ok(Array.isArray(res.movies));
  assert.equal(res.movies.length, 0);
});

test('getRecommendationsForUser rejects a forged token', async () => {
  const res = await callActionWithRawToken('', getRecommendationsForUser);
  assert.deepEqual(res.sets, []);
  assert.ok(res.error, 'an error is surfaced for an invalid token');
});

test('getRecommendationsForUser returns no sets when the user has no ratings', async () => {
  const res = await callActionAs(alice, getRecommendationsForUser);
  assert.deepEqual(res.sets, []);
  assert.equal(res.error, undefined);
});

test('getRecommendationsForUser handles a loved rating without crashing', async () => {
  // A rating >= 8 becomes a basis film. Whether TMDB is reachable or not, the
  // action must return an array of sets and never throw.
  await adminDb().collection('ratings').doc(`${alice.uid}_603`).set({
    userId: alice.uid,
    tmdbId: 603,
    mediaType: 'movie',
    movieTitle: 'the matrix',
    rating: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const res = await callActionAs(alice, getRecommendationsForUser);
  assert.ok(Array.isArray(res.sets), 'sets is always an array');
});
