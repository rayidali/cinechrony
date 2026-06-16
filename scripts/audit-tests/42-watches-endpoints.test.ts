/**
 * Phase 0.7 Wave 2 (slice 3) — watch-log endpoint tests.
 *
 * Covers `/api/v1/watches`:
 *   - POST logWatch — auth, validation, ordinal (first watch / rewatch no. N),
 *     rating upsert into /ratings, note → the caller's single review (create
 *     then UPDATE the same doc, never a second one), skip (no rating/note).
 *   - GET getWatchesForMovie — auth, tmdbId required, newest-first, owner-scoped
 *     (a caller never sees another user's watches).
 *
 * The `watches` subcollection is server-only + owner-read (see firestore.rules);
 * these route tests assert the orchestration + ownership boundary.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as watchPost, GET as watchGet } from '@/app/api/v1/watches/route';

let viewer: TestUser, other: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  viewer = await createTestUser('viewer');
  other = await createTestUser('other');
  // createReview (the "note becomes your review" path) denormalizes author
  // fields off the profile doc, so seed them.
  await adminDb().collection('users').doc(viewer.uid).set({
    uid: viewer.uid, username: 'viewer', usernameLower: 'viewer', displayName: 'Viewer', photoURL: null,
  });
  await adminDb().collection('users').doc(other.uid).set({
    uid: other.uid, username: 'other', usernameLower: 'other', displayName: 'Other', photoURL: null,
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const TMDB_ID = 603;
const base = { tmdbId: TMDB_ID, mediaType: 'movie' as const, movieTitle: 'The Matrix' };

async function getWatches(token: string, tmdbId = TMDB_ID) {
  const res = await callRoute<{ watches: Array<{ id: string; ordinal: number; rating: number | null; note: string | null }> }>(
    watchGet, 'GET', { token, url: `http://test/api/v1/watches?tmdbId=${tmdbId}` },
  );
  if (res.body.ok !== true) throw new Error('getWatches failed');
  return res.body.data.watches;
}

// ─── auth + validation ──────────────────────────────────────────────────────

test('POST /watches: unauth → 401', async () => {
  const res = await callRoute(watchPost, 'POST', { body: { ...base, rating: 8 } });
  assert.equal(res.status, 401);
});

test('GET /watches: unauth → 401', async () => {
  const res = await callRoute(watchGet, 'GET', { url: `http://test/api/v1/watches?tmdbId=${TMDB_ID}` });
  assert.equal(res.status, 401);
});

test('GET /watches: missing tmdbId → 400', async () => {
  const token = await viewer.getIdToken();
  const res = await callRoute(watchGet, 'GET', { token, url: 'http://test/api/v1/watches' });
  assert.equal(res.status, 400);
});

test('POST /watches: out-of-range rating → 400', async () => {
  const token = await viewer.getIdToken();
  for (const rating of [0, 10.5, -3]) {
    const res = await callRoute(watchPost, 'POST', { token, body: { ...base, rating } });
    assert.equal(res.status, 400, `rating ${rating} should reject`);
  }
});

// ─── ordinal + history ──────────────────────────────────────────────────────

test('logWatch sets ordinal (first watch → rewatch no. 2) and GET is newest-first', async () => {
  const token = await viewer.getIdToken();

  const r1 = await callRoute<{ watch: { ordinal: number } }>(watchPost, 'POST', {
    token, body: { ...base, rating: 9, note: 'the original still rips', watchedAt: '2023-06-01T00:00:00.000Z' },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok && r1.body.data.watch.ordinal, 1);

  const r2 = await callRoute<{ watch: { ordinal: number } }>(watchPost, 'POST', {
    token, body: { ...base, rating: 9.4, note: 'even better on a rewatch', watchedAt: '2024-12-01T00:00:00.000Z' },
  });
  assert.equal(r2.body.ok && r2.body.data.watch.ordinal, 2, 'second watch is rewatch no. 2');

  const watches = await getWatches(token);
  assert.equal(watches.length, 2);
  assert.equal(watches[0].ordinal, 2, 'newest watch first');
  assert.equal(watches[1].ordinal, 1);
});

// ─── rating + review side effects ───────────────────────────────────────────

test('logWatch upserts the canonical rating in /ratings', async () => {
  const token = await viewer.getIdToken();
  await callRoute(watchPost, 'POST', { token, body: { ...base, rating: 8.5 } });

  const ratingDoc = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.ok(ratingDoc.exists, 'rating doc written');
  assert.equal(ratingDoc.data()?.rating, 8.5);
});

test('a note becomes your single review — second note UPDATES it, never a duplicate', async () => {
  const token = await viewer.getIdToken();

  await callRoute(watchPost, 'POST', { token, body: { ...base, rating: 9, note: 'first take' } });
  let reviews = await adminDb().collection('reviews').where('userId', '==', viewer.uid).where('tmdbId', '==', TMDB_ID).get();
  assert.equal(reviews.size, 1, 'one review created');
  assert.equal(reviews.docs[0].data().text, 'first take');

  await callRoute(watchPost, 'POST', { token, body: { ...base, rating: 9.4, note: 'updated take on rewatch' } });
  reviews = await adminDb().collection('reviews').where('userId', '==', viewer.uid).where('tmdbId', '==', TMDB_ID).get();
  assert.equal(reviews.size, 1, 'still exactly one review (updated, not duplicated)');
  assert.equal(reviews.docs[0].data().text, 'updated take on rewatch');
});

test('skip (no rating, no note) logs the watch but writes no rating or review', async () => {
  const token = await viewer.getIdToken();
  const res = await callRoute<{ watch: { rating: number | null; note: string | null } }>(watchPost, 'POST', {
    token, body: { ...base },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok && res.body.data.watch.rating, null);

  const watches = await getWatches(token);
  assert.equal(watches.length, 1, 'watch still logged');

  const ratingDoc = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.equal(ratingDoc.exists, false, 'no rating on skip');
  const reviews = await adminDb().collection('reviews').where('userId', '==', viewer.uid).get();
  assert.equal(reviews.size, 0, 'no review on skip');
});

// ─── ownership boundary ─────────────────────────────────────────────────────

test('GET /watches is owner-scoped — a caller never sees another user’s watches', async () => {
  const viewerToken = await viewer.getIdToken();
  const otherToken = await other.getIdToken();

  await callRoute(watchPost, 'POST', { token: viewerToken, body: { ...base, rating: 9 } });

  const otherSees = await getWatches(otherToken);
  assert.equal(otherSees.length, 0, 'other user sees none of viewer’s watches');

  const viewerSees = await getWatches(viewerToken);
  assert.equal(viewerSees.length, 1);
});
