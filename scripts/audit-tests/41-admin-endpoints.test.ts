/**
 * Phase A.3 PR #16 — admin backfill endpoint tests.
 *
 * Covers:
 *   - POST /api/v1/admin/backfill-user-search       backfillUserSearchFields
 *   - POST /api/v1/admin/backfill-movies            backfillMovieUserData
 *   - POST /api/v1/admin/backfill-reviews           backfillReviewsThreading
 *   - POST /api/v1/admin/backfill-email-privacy     backfillEmailPrivacy
 *
 * Auth model (PR #16): one env var (`ADMIN_SECRET`), one check at the
 * route layer via `adminRoute` (`x-admin-token` header, constant-time
 * compare). Closes AUDIT 1.8 end-to-end — no more `"run-backfill-now"`
 * sentinel; no more dual `ADMIN_SECRET_TOKEN` / `ADMIN_SECRET` env vars.
 *
 * Tests pin ADMIN_SECRET to a known value + bypass the dev/test env
 * sniffing by setting NODE_ENV to 'production' before each call. That
 * lets us assert the production auth gate end-to-end.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, adminDb, clearFirestore, clearAuth,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as backfillUserSearchPost }
  from '@/app/api/v1/admin/backfill-user-search/route';
import { POST as backfillMoviesPost }
  from '@/app/api/v1/admin/backfill-movies/route';
import { POST as backfillReviewsPost }
  from '@/app/api/v1/admin/backfill-reviews/route';
import { POST as backfillEmailPost }
  from '@/app/api/v1/admin/backfill-email-privacy/route';

const TEST_SECRET = 'test-admin-secret-pr16';
const originalNodeEnv = process.env.NODE_ENV;

before(() => {
  setupTestEnv();
  process.env.ADMIN_SECRET = TEST_SECRET;
  // Force production-mode auth gating (no dev bypass) — direct assignment.
  process.env.NODE_ENV = 'production';
});

beforeEach(async () => { await clearFirestore(); });

after(async () => {
  await clearFirestore();
  await clearAuth();
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.ADMIN_SECRET;
});

// ─── Auth gate (applied uniformly to all 4 routes) ───────────────────────

test('admin routes: missing x-admin-token → 401', async () => {
  for (const handler of [
    backfillUserSearchPost,
    backfillMoviesPost,
    backfillReviewsPost,
    backfillEmailPost,
  ]) {
    const res = await callRoute(handler, 'POST', {});
    assert.equal(res.status, 401, `${handler.name}: expected 401`);
  }
});

test('admin routes: wrong x-admin-token → 401', async () => {
  for (const handler of [
    backfillUserSearchPost,
    backfillMoviesPost,
    backfillReviewsPost,
    backfillEmailPost,
  ]) {
    const res = await callRoute(handler, 'POST', {
      headers: { 'x-admin-token': 'definitely-wrong' },
    });
    assert.equal(res.status, 401);
  }
});

test('admin routes: ADMIN_SECRET unset in production → 500 (fails closed)', async () => {
  delete process.env.ADMIN_SECRET;
  try {
    const res = await callRoute(backfillUserSearchPost, 'POST', {
      headers: { 'x-admin-token': 'whatever' },
    });
    assert.equal(res.status, 500);
  } finally {
    process.env.ADMIN_SECRET = TEST_SECRET;
  }
});

test('admin routes: sentinel "run-backfill-now" no longer works (AUDIT 1.8)', async () => {
  const res = await callRoute(backfillMoviesPost, 'POST', {
    headers: { 'x-admin-token': 'run-backfill-now' },
  });
  assert.equal(res.status, 401);
});

// ─── backfill-user-search ────────────────────────────────────────────────

test('backfill-user-search: migrates legacy doc; idempotent on re-run', async () => {
  const db = adminDb();
  await db.collection('users').doc('legacy').set({
    uid: 'legacy', username: 'AliceLegacy', displayName: 'Alice Legacy',
  });
  await db.collection('users').doc('newer').set({
    uid: 'newer', username: 'bob', usernameLower: 'bob', displayName: 'Bob',
  });

  const res = await callRoute<{ stats: { migratedCount: number; skippedCount: number } }>(
    backfillUserSearchPost, 'POST', {
      headers: { 'x-admin-token': TEST_SECRET },
    },
  );
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.stats.migratedCount, 1, 'legacy migrated');
  assert.equal(res.body.data.stats.skippedCount, 1, 'newer (had usernameLower) skipped');

  // Idempotent: re-run touches nothing new.
  const second = await callRoute<{ stats: { migratedCount: number } }>(
    backfillUserSearchPost, 'POST', {
      headers: { 'x-admin-token': TEST_SECRET },
    },
  );
  if (second.body.ok !== true) return assert.fail('expected ok');
  assert.equal(second.body.data.stats.migratedCount, 0, 'nothing left to migrate');

  // Verify the legacy doc now has the normalized fields.
  const legacy = (await db.collection('users').doc('legacy').get()).data();
  assert.equal(legacy?.usernameLower, 'alicelegacy');
  assert.equal(legacy?.displayNameLower, 'alice legacy');
});

// ─── backfill-reviews ────────────────────────────────────────────────────

test('backfill-reviews: adds parentId+replyCount to legacy reviews; idempotent', async () => {
  const db = adminDb();
  await db.collection('reviews').doc('legacy-1').set({
    text: 'old review', tmdbId: 1, userId: 'u',
    // No parentId / replyCount.
  });
  await db.collection('reviews').doc('new-1').set({
    text: 'new review', tmdbId: 2, userId: 'u', parentId: null, replyCount: 0,
  });

  const res = await callRoute<{ stats: { updated: number; skipped: number; total: number } }>(
    backfillReviewsPost, 'POST', {
      headers: { 'x-admin-token': TEST_SECRET },
    },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.stats.updated, 1);
  assert.equal(res.body.data.stats.skipped, 1);
  assert.equal(res.body.data.stats.total, 2);

  const legacy = (await db.collection('reviews').doc('legacy-1').get()).data();
  assert.equal(legacy?.parentId, null);
  assert.equal(legacy?.replyCount, 0);

  // Idempotent.
  const second = await callRoute<{ stats: { updated: number } }>(
    backfillReviewsPost, 'POST', {
      headers: { 'x-admin-token': TEST_SECRET },
    },
  );
  if (second.body.ok !== true) return assert.fail('expected ok');
  assert.equal(second.body.data.stats.updated, 0);
});

// ─── backfill-email-privacy ──────────────────────────────────────────────

test('backfill-email-privacy: moves email to /users_private, strips public doc', async () => {
  const db = adminDb();
  await db.collection('users').doc('u1').set({
    uid: 'u1', username: 'alice', email: 'alice@example.com', emailLower: 'alice@example.com',
  });
  await db.collection('users').doc('u2').set({
    uid: 'u2', username: 'bob', // no email — already migrated
  });

  const res = await callRoute<{ stats: { migrated: number; skipped: number } }>(
    backfillEmailPost, 'POST', {
      headers: { 'x-admin-token': TEST_SECRET },
    },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.stats.migrated, 1);
  assert.equal(res.body.data.stats.skipped, 1);

  // Email moved off /users into /users_private.
  const u1 = (await db.collection('users').doc('u1').get()).data();
  assert.equal(u1?.email, undefined, 'email stripped from public doc');
  assert.equal(u1?.emailLower, undefined);
  const u1Private = (await db.collection('users_private').doc('u1').get()).data();
  assert.equal(u1Private?.email, 'alice@example.com');
});

// ─── backfill-movies (lighter — exercises auth + envelope shape) ─────────

test('backfill-movies: empty firestore → success, zeroed stats', async () => {
  const res = await callRoute<{ stats: { moviesProcessed: number; moviesUpdated: number } }>(
    backfillMoviesPost, 'POST', { headers: { 'x-admin-token': TEST_SECRET } },
  );
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.stats.moviesProcessed, 0);
  assert.equal(res.body.data.stats.moviesUpdated, 0);
});

test('backfill-movies: denormalizes addedBy* on legacy movie docs', async () => {
  const db = adminDb();
  await db.collection('users').doc('owner').set({
    uid: 'owner', username: 'alice', displayName: 'Alice', photoURL: 'https://x/a.png',
  });
  await db.collection('users').doc('owner').collection('lists').doc('L').set({ name: 'L' });
  await db.collection('users').doc('owner')
    .collection('lists').doc('L')
    .collection('movies').doc('M').set({
      tmdbId: 1, title: 'X', addedBy: 'owner',
      // missing addedByUsername / addedByDisplayName / addedByPhotoURL
    });

  await callRoute(backfillMoviesPost, 'POST', {
    headers: { 'x-admin-token': TEST_SECRET },
  });

  const movie = (await db.collection('users').doc('owner')
    .collection('lists').doc('L')
    .collection('movies').doc('M').get()).data();
  assert.equal(movie?.addedByUsername, 'alice');
  assert.equal(movie?.addedByDisplayName, 'Alice');
  assert.equal(movie?.addedByPhotoURL, 'https://x/a.png');
});
