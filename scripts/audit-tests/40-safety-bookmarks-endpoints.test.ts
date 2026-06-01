/**
 * Phase A.3 PR #15 — bookmarks + mutes + blocks + friends-watching +
 * reports endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/bookmarks                          saveItem (cache key)
 *   - GET    /api/v1/bookmarks                          getMyBookmarks (cache hydrator)
 *   - DELETE /api/v1/bookmarks/[type]/[id]              unsaveItem
 *   - GET    /api/v1/saved-feed?cursor=&limit=          getSavedFeed (hydrated)
 *   - POST   /api/v1/users/[uid]/mute                   muteUser
 *   - DELETE /api/v1/users/[uid]/mute                   unmuteUser
 *   - GET    /api/v1/me/mutes                           getMyMutes
 *   - POST   /api/v1/users/[uid]/block                  blockUser (+ side effects)
 *   - DELETE /api/v1/users/[uid]/block                  unblockUser
 *   - GET    /api/v1/me/block-context                   getMyBlockContext
 *   - GET    /api/v1/me/blocked-users                   getBlockedUsers (UserProfile[])
 *   - GET    /api/v1/friends-watching                   getFriendsWatching
 *   - POST   /api/v1/reports                            reportContent (rate-limited)
 *
 * Invariants:
 *   - all routes derive caller identity from Bearer token (no userId arg)
 *   - blockUser severs follows + revokes pending invites in BOTH directions
 *   - mute is unilateral (the mute target keeps seeing the muter)
 *   - bookmark doc id is deterministic — save is idempotent, unsave is no-op on miss
 *   - reportContent accepts ALL five content types (fixes legacy validator bug
 *     that only accepted 'review' | 'user' | 'list')
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as savePost, GET as listBookmarksGet }
  from '@/app/api/v1/bookmarks/route';
import { DELETE as unsaveDelete }
  from '@/app/api/v1/bookmarks/[itemType]/[itemId]/route';
import { GET as savedFeedGet } from '@/app/api/v1/saved-feed/route';
import { POST as mutePost, DELETE as unmuteDelete }
  from '@/app/api/v1/users/[uid]/mute/route';
import { GET as mutesGet } from '@/app/api/v1/me/mutes/route';
import { POST as blockPost, DELETE as unblockDelete }
  from '@/app/api/v1/users/[uid]/block/route';
import { GET as blockContextGet } from '@/app/api/v1/me/block-context/route';
import { GET as blockedUsersGet } from '@/app/api/v1/me/blocked-users/route';
import { GET as friendsWatchingGet } from '@/app/api/v1/friends-watching/route';
import { POST as reportsPost } from '@/app/api/v1/reports/route';

let alice: TestUser, bob: TestUser, carol: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function seedActivity(
  id: string, userId: string,
  opts: { atMs?: number; type?: string; tmdbId?: number } = {},
) {
  await adminDb().collection('activities').doc(id).set({
    userId, type: opts.type ?? 'rated', tmdbId: opts.tmdbId ?? 1, movieTitle: id,
    moviePosterUrl: null, movieYear: '2024', mediaType: 'movie',
    likes: 0, likedBy: [],
    createdAt: opts.atMs ? new Date(opts.atMs) : new Date(),
  });
}

async function seedPost(id: string, authorId: string, atMs = Date.now()) {
  await adminDb().collection('posts').doc(id).set({
    id, authorId, authorUsername: authorId, text: id, media: [],
    taggedMovie: null, taggedUserIds: [], taggedUsers: [], place: null,
    likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(atMs), updatedAt: new Date(atMs),
  });
}

// ─── BOOKMARKS ───────────────────────────────────────────────────────────

test('POST /bookmarks: unauth → 401', async () => {
  const res = await callRoute(savePost, 'POST', {
    body: { itemType: 'activity', itemId: 'a1' },
  });
  assert.equal(res.status, 401);
});

test('POST /bookmarks: bad itemType → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(savePost, 'POST', {
    token, body: { itemType: 'movie', itemId: 'a1' },
  });
  assert.equal(res.status, 400);
});

test('save + unsave round-trips; cache key list reflects state', async () => {
  const token = await alice.getIdToken();
  await callRoute(savePost, 'POST', {
    token, body: { itemType: 'activity', itemId: 'a1' },
  });
  let list = await callRoute<{ keys: string[] }>(listBookmarksGet, 'GET', { token });
  if (list.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(list.body.data.keys, ['activity_a1']);

  await callRoute(unsaveDelete, 'DELETE', {
    token, params: { itemType: 'activity', itemId: 'a1' },
  });
  list = await callRoute<{ keys: string[] }>(listBookmarksGet, 'GET', { token });
  if (list.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(list.body.data.keys, []);
});

test('save is idempotent on the same item', async () => {
  const token = await alice.getIdToken();
  await callRoute(savePost, 'POST', { token, body: { itemType: 'activity', itemId: 'a1' } });
  await callRoute(savePost, 'POST', { token, body: { itemType: 'activity', itemId: 'a1' } });
  const subs = await adminDb()
    .collection('users').doc(alice.uid)
    .collection('bookmarks').get();
  assert.equal(subs.size, 1, 'still one bookmark doc after double save');
});

test('getMyBookmarks returns only the caller\'s bookmarks', async () => {
  const aliceToken = await alice.getIdToken();
  const bobToken = await bob.getIdToken();
  await callRoute(savePost, 'POST', { token: aliceToken, body: { itemType: 'activity', itemId: 'aA' } });
  await callRoute(savePost, 'POST', { token: bobToken, body: { itemType: 'activity', itemId: 'bB' } });

  const res = await callRoute<{ keys: string[] }>(listBookmarksGet, 'GET', { token: aliceToken });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(res.body.data.keys, ['activity_aA']);
});

test('saved-feed hydrates activities + posts newest-saved first; skips dangling', async () => {
  // Seed source docs.
  await seedActivity('a1', bob.uid);
  await seedPost('p1', bob.uid);
  // alice saves both, then we delete the source 'a1' to test "dangling skipped".
  const token = await alice.getIdToken();
  await callRoute(savePost, 'POST', { token, body: { itemType: 'activity', itemId: 'a1' } });
  await callRoute(savePost, 'POST', { token, body: { itemType: 'post', itemId: 'p1' } });
  await adminDb().collection('activities').doc('a1').delete();

  const res = await callRoute<{ items: Array<{ kind: string }>; hasMore: boolean }>(
    savedFeedGet, 'GET', { token },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  // a1 dangling → skipped; p1 stays.
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.items[0].kind, 'post');
});

test('saved-feed: cursor pagination — 3 over 5 with limit=2', async () => {
  const token = await alice.getIdToken();
  for (let i = 0; i < 5; i++) {
    await seedActivity(`a${i}`, bob.uid, { atMs: 1_000 + i * 1_000 });
    await callRoute(savePost, 'POST', {
      token, body: { itemType: 'activity', itemId: `a${i}` },
    });
  }

  const page1 = await callRoute<{ items: unknown[]; hasMore: boolean; nextCursor?: string }>(
    savedFeedGet, 'GET', { token, url: 'http://test/api/v1/saved-feed?limit=2' },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.items.length, 2);
  assert.equal(page1.body.data.hasMore, true);

  const page2 = await callRoute<{ items: unknown[]; hasMore: boolean }>(
    savedFeedGet, 'GET',
    { token, url: `http://test/api/v1/saved-feed?limit=2&cursor=${page1.body.data.nextCursor}` },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.items.length, 2);
});

// ─── MUTES ───────────────────────────────────────────────────────────────

test('POST /users/[uid]/mute: unauth → 401', async () => {
  const res = await callRoute(mutePost, 'POST', { params: { uid: bob.uid } });
  assert.equal(res.status, 401);
});

test('cannot mute yourself → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(mutePost, 'POST', {
    token, params: { uid: alice.uid },
  });
  assert.equal(res.status, 400);
});

test('mute + getMyMutes + unmute round-trip', async () => {
  const aliceToken = await alice.getIdToken();
  await callRoute(mutePost, 'POST', { token: aliceToken, params: { uid: bob.uid } });

  let list = await callRoute<{ mutedIds: string[] }>(mutesGet, 'GET', { token: aliceToken });
  if (list.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(list.body.data.mutedIds, [bob.uid]);

  await callRoute(unmuteDelete, 'DELETE', { token: aliceToken, params: { uid: bob.uid } });
  list = await callRoute<{ mutedIds: string[] }>(mutesGet, 'GET', { token: aliceToken });
  if (list.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(list.body.data.mutedIds, []);
});

test('mute is unilateral — the muted user does NOT see the muter as muted', async () => {
  const aliceToken = await alice.getIdToken();
  await callRoute(mutePost, 'POST', { token: aliceToken, params: { uid: bob.uid } });

  const bobToken = await bob.getIdToken();
  const bobMutes = await callRoute<{ mutedIds: string[] }>(mutesGet, 'GET', { token: bobToken });
  if (bobMutes.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(bobMutes.body.data.mutedIds, []);
});

// ─── BLOCKS ──────────────────────────────────────────────────────────────

test('cannot block yourself → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(blockPost, 'POST', {
    token, params: { uid: alice.uid },
  });
  assert.equal(res.status, 400);
});

test('block → block-context union shows both directions', async () => {
  const aliceToken = await alice.getIdToken();
  await callRoute(blockPost, 'POST', { token: aliceToken, params: { uid: bob.uid } });

  const aliceCtx = await callRoute<{ blockedIds: string[]; iBlocked: string[] }>(
    blockContextGet, 'GET', { token: aliceToken },
  );
  if (aliceCtx.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(aliceCtx.body.data.iBlocked, [bob.uid]);
  assert.ok(aliceCtx.body.data.blockedIds.includes(bob.uid));

  const bobToken = await bob.getIdToken();
  const bobCtx = await callRoute<{ blockedIds: string[]; iBlocked: string[] }>(
    blockContextGet, 'GET', { token: bobToken },
  );
  if (bobCtx.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(bobCtx.body.data.iBlocked, []);
  assert.ok(bobCtx.body.data.blockedIds.includes(alice.uid), 'bob sees alice in his union');
});

test('unblock removes from iBlocked but does NOT restore the follow', async () => {
  const db = adminDb();
  // Seed alice → bob follow.
  await db.collection('users').doc(alice.uid).set({ followingCount: 1, followersCount: 0 });
  await db.collection('users').doc(bob.uid).set({ followingCount: 0, followersCount: 1 });
  await db.collection('users').doc(alice.uid).collection('following').doc(bob.uid).set({ id: bob.uid });
  await db.collection('users').doc(bob.uid).collection('followers').doc(alice.uid).set({ id: alice.uid });

  const aliceToken = await alice.getIdToken();
  await callRoute(blockPost, 'POST', { token: aliceToken, params: { uid: bob.uid } });
  await callRoute(unblockDelete, 'DELETE', { token: aliceToken, params: { uid: bob.uid } });

  const followExists = (await db.collection('users').doc(alice.uid)
    .collection('following').doc(bob.uid).get()).exists;
  assert.equal(followExists, false, 'follow not restored on unblock');

  const aliceCtx = await callRoute<{ blockedIds: string[] }>(
    blockContextGet, 'GET', { token: aliceToken },
  );
  if (aliceCtx.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(aliceCtx.body.data.blockedIds, []);
});

test('block revokes pending invites between the two users (best-effort)', async () => {
  const db = adminDb();
  // Seed a pending invite both ways.
  const inv1 = await db.collection('invites').add({
    inviterId: alice.uid, inviteeId: bob.uid, status: 'pending',
    listId: 'L1', listName: 'L', listOwnerId: alice.uid,
    createdAt: new Date(),
  });
  const inv2 = await db.collection('invites').add({
    inviterId: bob.uid, inviteeId: alice.uid, status: 'pending',
    listId: 'L2', listName: 'L', listOwnerId: bob.uid,
    createdAt: new Date(),
  });
  // An unrelated invite that must NOT be touched.
  const inv3 = await db.collection('invites').add({
    inviterId: alice.uid, inviteeId: carol.uid, status: 'pending',
    listId: 'L3', listName: 'L', listOwnerId: alice.uid,
    createdAt: new Date(),
  });

  const aliceToken = await alice.getIdToken();
  await callRoute(blockPost, 'POST', { token: aliceToken, params: { uid: bob.uid } });

  assert.equal((await inv1.get()).data()?.status, 'revoked');
  assert.equal((await inv2.get()).data()?.status, 'revoked');
  assert.equal((await inv3.get()).data()?.status, 'pending', 'unrelated invite untouched');
});

test('GET /me/blocked-users returns full UserProfile[] sans email', async () => {
  const db = adminDb();
  await db.collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bobby', displayName: 'Bob',
    followersCount: 0, followingCount: 0,
  });
  const aliceToken = await alice.getIdToken();
  await callRoute(blockPost, 'POST', { token: aliceToken, params: { uid: bob.uid } });

  const res = await callRoute<{ users: Array<{ uid: string; email: string; username: string | null }> }>(
    blockedUsersGet, 'GET', { token: aliceToken },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.users.length, 1);
  assert.equal(res.body.data.users[0].uid, bob.uid);
  assert.equal(res.body.data.users[0].email, '', 'email is never returned');
});

// ─── FRIENDS WATCHING ────────────────────────────────────────────────────

test('GET /friends-watching: unauth → 401', async () => {
  const res = await callRoute(friendsWatchingGet, 'GET', {});
  assert.equal(res.status, 401);
});

test('friends-watching: empty when caller follows no one', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ cards: unknown[] }>(friendsWatchingGet, 'GET', { token });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(res.body.data.cards, []);
});

test('friends-watching: collapses ≥2 followed users on the same film into one card', async () => {
  const db = adminDb();
  // alice follows bob + carol.
  await db.collection('users').doc(alice.uid).collection('following').doc(bob.uid).set({ id: bob.uid });
  await db.collection('users').doc(alice.uid).collection('following').doc(carol.uid).set({ id: carol.uid });
  // Both have an activity on tmdb 100.
  await seedActivity('a-bob-100', bob.uid, { tmdbId: 100 });
  await seedActivity('a-carol-100', carol.uid, { tmdbId: 100 });
  // bob has another activity on tmdb 200 alone — must NOT appear (< 2 friends).
  await db.collection('activities').doc('a-bob-200').set({
    userId: bob.uid, type: 'rated', tmdbId: 200, movieTitle: 'solo', mediaType: 'movie',
    moviePosterUrl: null, movieYear: '2024', likes: 0, likedBy: [],
    createdAt: new Date(),
  });

  const token = await alice.getIdToken();
  const res = await callRoute<{ cards: Array<{ tmdbId: number; friends: unknown[] }> }>(
    friendsWatchingGet, 'GET', { token },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  const tmdbIds = res.body.data.cards.map((c) => c.tmdbId);
  assert.ok(tmdbIds.includes(100));
  assert.ok(!tmdbIds.includes(200), 'solo film excluded — <2 friends');
  const card100 = res.body.data.cards.find((c) => c.tmdbId === 100)!;
  assert.equal(card100.friends.length, 2);
});

// ─── REPORTS ─────────────────────────────────────────────────────────────

test('POST /reports: unauth → 401', async () => {
  const res = await callRoute(reportsPost, 'POST', {
    body: { contentType: 'user', targetId: 'x' },
  });
  assert.equal(res.status, 401);
});

test('POST /reports: bad contentType → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(reportsPost, 'POST', {
    token, body: { contentType: 'spaceship', targetId: 'x' },
  });
  assert.equal(res.status, 400);
});

test('POST /reports: missing targetId → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(reportsPost, 'POST', {
    token, body: { contentType: 'user', targetId: '' },
  });
  assert.equal(res.status, 400);
});

test('POST /reports: post + post_comment now accepted (legacy bug fix)', async () => {
  const token = await alice.getIdToken();
  for (const contentType of ['post', 'post_comment'] as const) {
    const res = await callRoute(reportsPost, 'POST', {
      token, body: { contentType, targetId: 'x', reason: 'r' },
    });
    assert.equal(res.status, 200, `${contentType} should be accepted`);
  }
});

test('POST /reports: reason truncated at 1000 chars', async () => {
  const token = await alice.getIdToken();
  const longReason = 'a'.repeat(2000);
  await callRoute(reportsPost, 'POST', {
    token,
    body: { contentType: 'user', targetId: bob.uid, reason: longReason },
  });
  const reports = await adminDb().collection('reports').get();
  assert.equal(reports.size, 1);
  const r = reports.docs[0].data();
  assert.equal(r.reason.length, 1000);
  assert.equal(r.reporterId, alice.uid);
});

test('POST /reports: persisted with status pending', async () => {
  const token = await alice.getIdToken();
  await callRoute(reportsPost, 'POST', {
    token, body: { contentType: 'review', targetId: 'rev-1', reason: 'spam' },
  });
  const reports = await adminDb().collection('reports').get();
  assert.equal(reports.size, 1);
  const r = reports.docs[0].data();
  assert.equal(r.contentType, 'review');
  assert.equal(r.targetId, 'rev-1');
  assert.equal(r.status, 'pending');
});
