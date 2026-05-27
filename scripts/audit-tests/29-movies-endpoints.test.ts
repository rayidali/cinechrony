/**
 * Phase A.3 PR #4 — movies-in-lists endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/lists/[ownerId]/[listId]/movies                  (add)
 *   - DELETE /api/v1/lists/[ownerId]/[listId]/movies/[movieId]        (remove)
 *   - PATCH  /api/v1/lists/[ownerId]/[listId]/movies/[movieId]        (status / note / socialLink)
 *
 * AUDIT regression coverage:
 *   - 1.6 — `notes.${uid}` keyed by VERIFIED caller (note spoof prevention) —
 *     this file owns the "verified caller" + "collaborator can read but not
 *     overwrite owner's note" cases. The wider attack from
 *     `07-special-cases-auth` also routes through the new PATCH endpoint.
 *   - 2.2 — transactional movieCount invariants live in `09-moviecount.test.ts`
 *     (migrated to the new routes in PR #4).
 *   - 2.2.3 — Firestore Admin rejects undefined; the route must coalesce
 *     missing TMDB fields (posterHint etc.) to null. Tested here.
 *
 * Bypass regression: the legacy client used `updateDocumentNonBlocking` to
 * patch status / socialLink and `deleteDocumentNonBlocking` to remove movies,
 * bypassing `canEditList`. PR #4 routes that path through the API surface and
 * enforces canEditList server-side. The "stranger → 403" tests pin that.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as postMovie } from '@/app/api/v1/lists/[ownerId]/[listId]/movies/route';
import { PATCH as patchMovie, DELETE as deleteMovie }
  from '@/app/api/v1/lists/[ownerId]/[listId]/movies/[movieId]/route';

let owner: TestUser, collab: TestUser, stranger: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  collab = await createTestUser('collab');
  stranger = await createTestUser('stranger');
  await adminDb().collection('users').doc(owner.uid).set({
    uid: owner.uid, username: 'ownername', displayName: 'Owner', photoURL: null,
  });
  await adminDb().collection('users').doc(collab.uid).set({
    uid: collab.uid, username: 'collabname', displayName: 'Collab', photoURL: null,
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const LIST_ID = 'L1';
const listRef = () => adminDb()
  .collection('users').doc(owner.uid)
  .collection('lists').doc(LIST_ID);
const movieRef = (id: string) => listRef().collection('movies').doc(id);

async function seedList(opts: { collaborators?: string[]; movieCount?: number } = {}) {
  await listRef().set({
    id: LIST_ID,
    name: 'A list',
    ownerId: owner.uid,
    collaboratorIds: opts.collaborators ?? [collab.uid],
    isPublic: false,
    movieCount: opts.movieCount ?? 0,
  });
}

function tmdbMovie(opts: Partial<{ id: string; title: string; year: string; posterHint: string }> = {}) {
  return {
    id: opts.id ?? '42',
    title: opts.title ?? 'Test',
    year: opts.year ?? '2024',
    posterUrl: 'http://example/x.jpg',
    mediaType: 'movie' as const,
    ...(opts.posterHint !== undefined ? { posterHint: opts.posterHint } : {}),
  };
}

// ─── POST /api/v1/lists/[ownerId]/[listId]/movies ────────────────────────

test('POST /movies: unauth → 401', async () => {
  await seedList();
  const res = await callRoute(postMovie, 'POST', {
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie() },
  });
  assert.equal(res.status, 401);
});

test('POST /movies: missing movieData → 400', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: {},
  });
  assert.equal(res.status, 400);
});

test('POST /movies: stranger → 403', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie() },
  });
  assert.equal(res.status, 403);
});

test('POST /movies: owner happy path', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute<{ movieId: string; isNew: boolean }>(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '100' }) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok !== true) return;
  assert.equal(res.body.data.isNew, true);

  const movie = await movieRef(res.body.data.movieId).get();
  assert.equal(movie.exists, true);
  assert.equal(movie.data()?.addedBy, owner.uid);
  assert.equal(movie.data()?.addedByUsername, 'ownername', 'denormalized author');
});

test('POST /movies: collaborator can add (canEditList enforced server-side)', async () => {
  await seedList();
  const token = await collab.getIdToken();
  const res = await callRoute(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '200' }) },
  });
  assert.equal(res.status, 200);
});

test('POST /movies: re-add same movie does NOT double-count (AUDIT 2.2)', async () => {
  await seedList();
  const token = await owner.getIdToken();
  await callRoute(postMovie, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '300' }) },
  });
  await callRoute(postMovie, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '300' }) },
  });
  const list = (await listRef().get()).data();
  assert.equal(list?.movieCount, 1, 'second add is idempotent');
});

test('POST /movies: note written under verified uid + denormalized author', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute<{ movieId: string }>(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '400' }), note: 'great film' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  const movie = (await movieRef(res.body.data.movieId).get()).data();
  assert.equal(movie?.notes?.[owner.uid], 'great film');
  assert.equal(movie?.noteAuthors?.[owner.uid]?.username, 'ownername');
});

test('POST /movies: missing posterHint coalesced to null (AUDIT 2.2.3)', async () => {
  // Pre-fix this hard-failed because Firestore Admin rejects undefined.
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute<{ movieId: string }>(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '500' }) }, // no posterHint
  });
  assert.equal(res.status, 200, 'add succeeded despite undefined posterHint');
  if (res.body.ok !== true) return;
  const movie = (await movieRef(res.body.data.movieId).get()).data();
  assert.equal(movie?.posterHint, null);
});

test('POST /movies: invalid status → 400', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(postMovie, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { movieData: tmdbMovie({ id: '600' }), status: 'nope' },
  });
  assert.equal(res.status, 400);
});

// ─── DELETE /api/v1/lists/[ownerId]/[listId]/movies/[movieId] ────────────

test('DELETE /movies/[id]: unauth → 401', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  const res = await callRoute(deleteMovie, 'DELETE', {
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
  });
  assert.equal(res.status, 401);
});

test('DELETE /movies/[id]: stranger → 403 (bypass-via-Firestore now blocked)', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  await listRef().update({ movieCount: 1 });

  const token = await stranger.getIdToken();
  const res = await callRoute(deleteMovie, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
  });
  assert.equal(res.status, 403);
  const movie = await movieRef('m').get();
  assert.equal(movie.exists, true, 'movie untouched');
  assert.equal((await listRef().get()).data()?.movieCount, 1);
});

test('DELETE /movies/[id]: owner removes', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  await listRef().update({ movieCount: 1 });

  const token = await owner.getIdToken();
  const res = await callRoute(deleteMovie, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
  });
  assert.equal(res.status, 200);
  assert.equal((await movieRef('m').get()).exists, false);
});

test('DELETE /movies/[id]: collaborator can remove', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  await listRef().update({ movieCount: 1 });

  const token = await collab.getIdToken();
  const res = await callRoute(deleteMovie, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
  });
  assert.equal(res.status, 200);
});

// ─── PATCH /api/v1/lists/[ownerId]/[listId]/movies/[movieId] ─────────────

test('PATCH /movies/[id]: unauth → 401', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', status: 'To Watch' });
  const res = await callRoute(patchMovie, 'PATCH', {
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  assert.equal(res.status, 401);
});

test('PATCH /movies/[id]: empty body → 400', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: {},
  });
  assert.equal(res.status, 400);
});

test('PATCH /movies/[id]: stranger → 403 (bypass-via-Firestore now blocked)', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', status: 'To Watch' });
  const token = await stranger.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  assert.equal(res.status, 403);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.status, 'To Watch', 'status untouched');
});

test('PATCH /movies/[id]: owner can flip status', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', status: 'To Watch' });
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  assert.equal(res.status, 200);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.status, 'Watched');
});

test('PATCH /movies/[id]: collaborator can flip status (canEditList allows)', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', status: 'To Watch' });
  const token = await collab.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  assert.equal(res.status, 200);
});

test('PATCH /movies/[id]: socialLink update (canEditList only — no per-user key)', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  const token = await collab.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { socialLink: 'https://www.tiktok.com/@x/video/123' },
  });
  assert.equal(res.status, 200);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.socialLink, 'https://www.tiktok.com/@x/video/123');
});

test('PATCH /movies/[id]: empty socialLink stores null (legacy-compat for `socialLink && ...` UI guards)', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', socialLink: 'http://prior' });
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { socialLink: '' },
  });
  assert.equal(res.status, 200);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.socialLink, null);
});

test('PATCH /movies/[id]: note keyed to verified caller (AUDIT 1.6)', async () => {
  await seedList();
  await movieRef('m').set({
    id: 'm', title: 'X',
    notes: { [owner.uid]: 'owner private note' },
    noteAuthors: { [owner.uid]: { username: 'ownername' } },
  });
  // collab patches a note. The body has no `userId` parameter — the route
  // derives it from the bearer token. So the only key collab can ever write
  // to is `notes.${collab.uid}`.
  const token = await collab.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { note: 'collab thought' },
  });
  assert.equal(res.status, 200);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.notes?.[owner.uid], 'owner private note', "owner's note intact");
  assert.equal(movie?.notes?.[collab.uid], 'collab thought');
  assert.equal(movie?.noteAuthors?.[collab.uid]?.username, 'collabname', 'denormalized author');
});

test('PATCH /movies/[id]: empty note deletes ONLY caller\'s note', async () => {
  await seedList();
  await movieRef('m').set({
    id: 'm', title: 'X',
    notes: { [owner.uid]: 'owner note', [collab.uid]: 'collab note' },
    noteAuthors: {
      [owner.uid]: { username: 'ownername' },
      [collab.uid]: { username: 'collabname' },
    },
  });
  const token = await collab.getIdToken();
  await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { note: '' },
  });
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.notes?.[owner.uid], 'owner note', "owner's note untouched");
  assert.equal(movie?.notes?.[collab.uid], undefined, "collab's note deleted");
});

test('PATCH /movies/[id]: missing movie → 404', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'does-not-exist' },
    body: { status: 'Watched' },
  });
  assert.equal(res.status, 404);
});

test('PATCH /movies/[id]: invalid status → 400', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X' });
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'bogus' },
  });
  assert.equal(res.status, 400);
});

test('PATCH /movies/[id]: status To Watch → Watched writes a "watched" activity', async () => {
  await seedList();
  await movieRef('m').set({
    id: 'm', title: 'Film', status: 'To Watch',
    tmdbId: 123, posterUrl: null, year: '2024', mediaType: 'movie',
  });
  const token = await owner.getIdToken();
  await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  const activities = await adminDb().collection('activities')
    .where('userId', '==', owner.uid)
    .where('type', '==', 'watched')
    .get();
  assert.equal(activities.size, 1, 'one watched activity created');
});

test('PATCH /movies/[id]: status Watched → Watched does NOT duplicate activity', async () => {
  await seedList();
  await movieRef('m').set({
    id: 'm', title: 'Film', status: 'Watched',
    tmdbId: 123, posterUrl: null, year: '2024', mediaType: 'movie',
  });
  const token = await owner.getIdToken();
  await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: { status: 'Watched' },
  });
  const activities = await adminDb().collection('activities')
    .where('userId', '==', owner.uid)
    .where('type', '==', 'watched')
    .get();
  assert.equal(activities.size, 0, 'no spurious activity from idempotent status');
});

test('PATCH /movies/[id]: combined status + note + socialLink in one request', async () => {
  await seedList();
  await movieRef('m').set({ id: 'm', title: 'X', status: 'To Watch' });
  const token = await owner.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID, movieId: 'm' },
    body: {
      status: 'Watched',
      note: 'good',
      socialLink: 'https://www.tiktok.com/@x/video/123',
    },
  });
  assert.equal(res.status, 200);
  const movie = (await movieRef('m').get()).data();
  assert.equal(movie?.status, 'Watched');
  assert.equal(movie?.notes?.[owner.uid], 'good');
  assert.equal(movie?.socialLink, 'https://www.tiktok.com/@x/video/123');
});
