/**
 * Phase 0.7 — leaderboard via the home-rail snapshot (free-tier scale fix).
 *
 * The week leaderboard is served from a global `/snapshots/home` doc built by
 * ONE activity scan (instead of a per-user 800-doc scan). Under the test
 * emulator the snapshot bypasses its cache and builds fresh from seeded
 * activities, so these assert the aggregation + filtering directly:
 *   - ranks ALL users GLOBALLY by distinct films logged this week (2026-07: was
 *     wrongly scoped to the caller's follow-graph; it's an app-wide board)
 *   - only "seen" signals (watched/rated/reviewed) count; 'added' does not
 *   - blocked users are excluded (the one per-caller filter)
 *   - non-followed users ARE included (the board is global)
 *   - fallback=1 widens to all-recent when the week is empty
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as leaderboardGet } from '@/app/api/v1/leaderboard/route';

let me_: TestUser, alice: TestUser, bob: TestUser, stranger: TestUser;

before(() => { setupTestEnv(); });

const DAY = 24 * 60 * 60 * 1000;

/** Seed an activity doc (createdAt defaults to "now"). */
async function seedActivity(uid: string, tmdbId: number, opts: { type?: string; daysAgo?: number; username?: string } = {}) {
  await adminDb().collection('activities').add({
    userId: uid,
    username: opts.username ?? uid,
    displayName: opts.username ?? uid,
    photoURL: null,
    type: opts.type ?? 'watched',
    tmdbId,
    movieTitle: `film ${tmdbId}`,
    moviePosterUrl: null,
    movieYear: '2024',
    mediaType: 'movie',
    createdAt: new Date(Date.now() - (opts.daysAgo ?? 0) * DAY),
  });
}

beforeEach(async () => {
  await clearFirestore();
  me_ = await createTestUser('me');
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  stranger = await createTestUser('stranger');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function board(token: string, qs = 'window=week&fallback=1') {
  const res = await callRoute<{ entries: Array<{ uid: string; films: number; rank: number }> }>(
    leaderboardGet, 'GET', { token, url: `http://test/api/v1/leaderboard?${qs}` },
  );
  if (res.body.ok !== true) throw new Error('leaderboard failed');
  return res.body.data.entries;
}

test('GET /leaderboard: unauth → 401', async () => {
  const res = await callRoute(leaderboardGet, 'GET', { url: 'http://test/api/v1/leaderboard?window=week' });
  assert.equal(res.status, 401);
});

test('ranks by distinct films this week; only seen-signals count', async () => {
  // alice: 3 distinct watched films this week
  await seedActivity(alice.uid, 1, { username: 'alice' });
  await seedActivity(alice.uid, 2, { username: 'alice' });
  await seedActivity(alice.uid, 3, { username: 'alice' });
  // bob: 1 watched + 1 'added' (added must NOT count) → 1 film
  await seedActivity(bob.uid, 1, { username: 'bob' });
  await seedActivity(bob.uid, 9, { type: 'added', username: 'bob' });

  const token = await me_.getIdToken();
  const entries = await board(token);
  const byUid = Object.fromEntries(entries.map((e) => [e.uid, e]));
  assert.equal(byUid[alice.uid].films, 3, 'alice has 3 distinct seen films');
  assert.equal(byUid[bob.uid].films, 1, "bob's 'added' does not count");
  assert.equal(byUid[alice.uid].rank, 1, 'alice ranks above bob');
  assert.ok(byUid[alice.uid].rank < byUid[bob.uid].rank);
});

test('includes non-followed users (the board is GLOBAL, not follow-scoped)', async () => {
  // No follows anywhere. A stranger the caller does not follow must still rank.
  await seedActivity(alice.uid, 1, { username: 'alice' });
  await seedActivity(stranger.uid, 1, { username: 'stranger' });
  await seedActivity(stranger.uid, 2, { username: 'stranger' });

  const entries = await board(await me_.getIdToken());
  const byUid = Object.fromEntries(entries.map((e) => [e.uid, e]));
  assert.ok(byUid[alice.uid], 'alice is ranked');
  assert.ok(byUid[stranger.uid], 'the unfollowed stranger is ALSO ranked (global board)');
  assert.equal(byUid[stranger.uid].films, 2);
  assert.ok(byUid[stranger.uid].rank < byUid[alice.uid].rank, 'stranger (2 films) outranks alice (1)');
});

test('excludes blocked users', async () => {
  await seedActivity(alice.uid, 1, { username: 'alice' });
  await seedActivity(bob.uid, 2, { username: 'bob' });
  // me blocks bob
  await adminDb().collection('blocks').doc(`${me_.uid}_${bob.uid}`)
    .set({ blockerId: me_.uid, blockedId: bob.uid, createdAt: new Date() });

  const uids = (await board(await me_.getIdToken())).map((e) => e.uid);
  assert.ok(uids.includes(alice.uid));
  assert.ok(!uids.includes(bob.uid), 'blocked bob excluded from the board');
});

test('this-week filtering: an old watch does not count toward the week', async () => {
  await seedActivity(alice.uid, 1, { username: 'alice', daysAgo: 0 });
  await seedActivity(alice.uid, 2, { username: 'alice', daysAgo: 20 }); // outside the 7-day window

  // window=week WITHOUT fallback → only the in-week film counts
  const entries = await board(await me_.getIdToken(), 'window=week');
  const alice_ = entries.find((e) => e.uid === alice.uid);
  assert.equal(alice_?.films, 1, 'only the in-week watch counts');
});

test('fallback=1 widens to all-recent when the week is empty', async () => {
  await seedActivity(alice.uid, 1, { username: 'alice', daysAgo: 30 }); // old — outside week

  const withFallback = await board(await me_.getIdToken(), 'window=week&fallback=1');
  assert.ok(withFallback.some((e) => e.uid === alice.uid), 'fallback surfaces the old watch');

  const noFallback = await board(await me_.getIdToken(), 'window=week');
  assert.equal(noFallback.length, 0, 'without fallback an empty week reads honestly empty');
});
