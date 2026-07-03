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
import { PATCH as watchPatch, DELETE as watchDelete } from '@/app/api/v1/watches/[watchId]/route';
import { GET as watchRecent } from '@/app/api/v1/watches/recent/route';

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

test('logWatch is idempotent — an identical same-day re-submit is not a phantom rewatch', async () => {
  const token = await viewer.getIdToken();
  const body = { ...base, rating: 8, note: 'great', watchedAt: '2024-05-01T00:00:00.000Z' };
  const r1 = await callRoute<{ watch: { id: string; ordinal: number } }>(watchPost, 'POST', { token, body });
  const r2 = await callRoute<{ watch: { id: string; ordinal: number } }>(watchPost, 'POST', { token, body });
  assert.equal(r1.body.ok && r1.body.data.watch.ordinal, 1);
  assert.equal(r2.body.ok && r2.body.data.watch.ordinal, 1, 'a double-tap returns the same watch, not rewatch no. 2');
  assert.ok(r1.body.ok && r2.body.ok && r1.body.data.watch.id === r2.body.data.watch.id, 'same doc (idempotent)');
  assert.equal((await getWatches(token)).length, 1, 'only one watch doc exists');
});

test('logWatch still allows a genuine rewatch for a different date in the same window', async () => {
  const token = await viewer.getIdToken();
  await callRoute(watchPost, 'POST', { token, body: { ...base, rating: 8, watchedAt: '2024-06-01T00:00:00.000Z' } });
  const r2 = await callRoute<{ watch: { ordinal: number } }>(watchPost, 'POST', {
    token, body: { ...base, rating: 8, watchedAt: '2024-07-01T00:00:00.000Z' },
  });
  assert.equal(r2.body.ok && r2.body.data.watch.ordinal, 2, 'a different watched-date is a real rewatch');
  assert.equal((await getWatches(token)).length, 2);
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

// ─── edit + remove a watch ──────────────────────────────────────────────────

async function logWatch(token: string, body: Record<string, unknown>) {
  const r = await callRoute<{ watch: { id: string } }>(watchPost, 'POST', { token, body: { ...base, ...body } });
  if (r.body.ok !== true) throw new Error('logWatch failed');
  return r.body.data.watch;
}

test('PATCH /watches/[id]: unauth → 401', async () => {
  const res = await callRoute(watchPatch, 'PATCH', { params: { watchId: 'x' }, body: { rating: 8 } });
  assert.equal(res.status, 401);
});

test('PATCH /watches/[id]: edits the watch rating + note (not the canonical rating)', async () => {
  const token = await viewer.getIdToken();
  const w = await logWatch(token, { rating: 9, note: 'first take' });

  const res = await callRoute<{ watch: { rating: number; note: string } }>(
    watchPatch, 'PATCH', { token, params: { watchId: w.id }, body: { rating: 6.5, note: 'on reflection, mid' } },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok && res.body.data.watch.rating, 6.5);
  assert.equal(res.body.ok && res.body.data.watch.note, 'on reflection, mid');

  // canonical rating untouched by a watch edit (logWatch set it to 9)
  const ratingDoc = await adminDb().collection('ratings').doc(`${viewer.uid}_${TMDB_ID}`).get();
  assert.equal(ratingDoc.data()?.rating, 9, 'watch edit does not move the canonical rating');
});

test('DELETE /watches/[id]: removes the watch and remaining watches re-derive ordinals', async () => {
  const token = await viewer.getIdToken();
  const w1 = await logWatch(token, { rating: 9, watchedAt: '2023-06-01T00:00:00.000Z' });
  await logWatch(token, { rating: 9.4, watchedAt: '2024-12-01T00:00:00.000Z' });

  let watches = await getWatches(token);
  assert.equal(watches.length, 2);

  // delete the FIRST watch (2023) — the 2024 one should become ordinal 1 "first watch"
  const del = await callRoute(watchDelete, 'DELETE', { token, params: { watchId: w1.id } });
  assert.equal(del.status, 200);

  watches = await getWatches(token);
  assert.equal(watches.length, 1);
  assert.equal(watches[0].ordinal, 1, 'survivor re-derives to first watch');
});

test('PATCH/DELETE /watches/[id]: another user cannot touch your watch (owner-scoped → 404)', async () => {
  const viewerToken = await viewer.getIdToken();
  const otherToken = await other.getIdToken();
  const w = await logWatch(viewerToken, { rating: 8 });

  const patch = await callRoute(watchPatch, 'PATCH', { token: otherToken, params: { watchId: w.id }, body: { rating: 1 } });
  assert.equal(patch.status, 404, 'other user cannot edit viewer’s watch');
  const del = await callRoute(watchDelete, 'DELETE', { token: otherToken, params: { watchId: w.id } });
  assert.equal(del.status, 404, 'other user cannot delete viewer’s watch');

  // viewer's watch is intact
  const watches = await getWatches(viewerToken);
  assert.equal(watches.length, 1);
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

// ─── GET /watches/recent (film-picker rail) ─────────────────────────────────

test('GET /watches/recent: distinct films, newest first, owner-scoped', async () => {
  const viewerToken = await viewer.getIdToken();
  // Two watches of The Matrix (603) + one of a different film (550), oldest→newest.
  await callRoute(watchPost, 'POST', { token: viewerToken, body: { ...base, rating: 8, watchedAt: '2024-01-01T00:00:00.000Z' } });
  await callRoute(watchPost, 'POST', { token: viewerToken, body: { tmdbId: 550, mediaType: 'movie', movieTitle: 'Fight Club', watchedAt: '2024-02-01T00:00:00.000Z' } });
  await callRoute(watchPost, 'POST', { token: viewerToken, body: { ...base, rating: 9, watchedAt: '2024-03-01T00:00:00.000Z' } });

  const res = await callRoute<{ films: { tmdbId: number; title: string }[] }>(watchRecent, 'GET', { token: viewerToken });
  if (res.body.ok !== true) return assert.fail('expected ok');
  const films = res.body.data.films;
  // Distinct by tmdbId (Matrix appears once), newest watch first → Matrix (Mar), Fight Club (Feb).
  assert.deepEqual(films.map((f) => f.tmdbId), [603, 550]);

  // Owner-scoped: another user sees none of viewer's recents.
  const otherRes = await callRoute<{ films: unknown[] }>(watchRecent, 'GET', { token: await other.getIdToken() });
  if (otherRes.body.ok !== true) return assert.fail('expected ok');
  assert.equal(otherRes.body.data.films.length, 0);
});

test('GET /watches/recent: unauth → 401', async () => {
  const res = await callRoute(watchRecent, 'GET', {});
  assert.equal(res.status, 401);
});
