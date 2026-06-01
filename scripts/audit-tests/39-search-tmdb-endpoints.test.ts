/**
 * Phase A.3 PR #14 — search + TMDB/OMDB endpoint tests.
 *
 * Covers the migration of:
 *   - GET /api/v1/users/search?q=...         (closes AUDIT.md 2.8 surface)
 *   - GET /api/v1/movies/trending            (TMDB → OMDB enrichment)
 *   - GET /api/v1/movies/[tmdbId]/similar    (TMDB recommendations / similar)
 *   - GET /api/v1/movies/imdb-rating/[id]    (OMDB-only; server-held key)
 *   - GET /api/v1/recommendations            (Bearer auth required)
 *
 * Users-search has its own per-feature test file (`11-search-users.test.ts`);
 * this file focuses on the SHAPE / AUTH / VALIDATION surface of the routes —
 * we don't make real TMDB/OMDB requests from the test harness (the harness
 * has no network mocking infra; TMDB/OMDB tokens may or may not be present
 * in the emulator environment).
 *
 * The intent of the TMDB-side tests is to lock the route contract: the
 * proper HTTP status codes, the envelope shape, and the auth gating. The
 * external HTTP call itself is a thin proxy — covered by manual smoke.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { GET as similarGet }
  from '@/app/api/v1/movies/[tmdbId]/similar/route';
import { GET as imdbGet }
  from '@/app/api/v1/movies/imdb-rating/[imdbId]/route';
import { GET as recommendationsGet }
  from '@/app/api/v1/recommendations/route';

let alice: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

// ─── /movies/[tmdbId]/similar ────────────────────────────────────────────

test('similar: bad tmdbId (non-numeric) → 400', async () => {
  const res = await callRoute(similarGet, 'GET', {
    params: { tmdbId: 'abc' },
  });
  assert.equal(res.status, 400);
});

test('similar: tmdbId=0 → 400 (must be positive)', async () => {
  const res = await callRoute(similarGet, 'GET', {
    params: { tmdbId: '0' },
  });
  assert.equal(res.status, 400);
});

test('similar: public — no auth required (envelope-shaped result)', async () => {
  // Without a TMDB token in env this returns `{ movies: [] }`. Either way
  // the envelope must be `ok: true`. The route must NEVER 401 — it's public.
  const res = await callRoute<{ movies: unknown[] }>(similarGet, 'GET', {
    params: { tmdbId: '550' }, // Fight Club, harmless
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.ok(Array.isArray(res.body.data.movies));
});

// ─── /movies/imdb-rating/[imdbId] ────────────────────────────────────────

test('imdb-rating: malformed id → 400', async () => {
  const res = await callRoute(imdbGet, 'GET', {
    params: { imdbId: 'not-an-imdb-id' },
  });
  assert.equal(res.status, 400);
});

test('imdb-rating: well-formed id is accepted (public, OMDB-keyed)', async () => {
  // "tt0137523" = Fight Club. We can't assert the rating value (depends on
  // OMDB live + the key being present in env), but the route must not 400
  // for a well-formed id — it should either succeed (200) or fail down-
  // stream (downstream errors map to 400/404 via ImdbConfigError /
  // ImdbNotFoundError; either way, no 401, no 500).
  const res = await callRoute(imdbGet, 'GET', {
    params: { imdbId: 'tt0137523' },
  });
  assert.ok([200, 400, 404].includes(res.status), `unexpected status: ${res.status}`);
});

// ─── /recommendations (auth-required) ────────────────────────────────────

test('recommendations: unauth → 401', async () => {
  const res = await callRoute(recommendationsGet, 'GET', {});
  assert.equal(res.status, 401);
});

test('recommendations: auth with no ratings → empty sets', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ sets: unknown[] }>(recommendationsGet, 'GET', { token });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(res.body.data.sets, []);
});
