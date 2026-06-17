/**
 * Phase 0.7 — reviews wall (F12) + reactions (F14).
 *
 * GET /api/v1/movies/[tmdbId]/reviews-wall returns the aggregate summary
 * (friends'-framed score + loved/liked/fine/nope distribution + friends-seen) +
 * top-level reviews with their reply bubbles, minus blocked authors. POST/DELETE
 * /api/v1/reviews/[id]/react sets/replaces/removes the caller's one reaction.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as wallGet } from '@/app/api/v1/movies/[tmdbId]/reviews-wall/route';
import { POST as reactPost, DELETE as reactDelete } from '@/app/api/v1/reviews/[id]/react/route';

let me_: TestUser, alice: TestUser, bob: TestUser, stranger: TestUser;
const FILM = 500;
let seq = 0;

before(() => { setupTestEnv(); });

type SeedReview = {
  uid: string;
  username?: string;
  text?: string;
  rating?: number | null;
  parentId?: string | null;
  tmdbId?: number;
  likedBy?: string[];
  reactions?: Record<string, string>;
};

/** Seed a /reviews doc, return its id. */
async function seedReview(o: SeedReview): Promise<string> {
  seq += 1;
  const ref = await adminDb().collection('reviews').add({
    tmdbId: o.tmdbId ?? FILM,
    mediaType: 'movie',
    movieTitle: 'test film',
    moviePosterUrl: null,
    userId: o.uid,
    username: o.username ?? o.uid,
    userDisplayName: o.username ?? o.uid,
    userPhotoUrl: null,
    text: o.text ?? 'a take',
    ratingAtTime: o.rating === undefined ? null : o.rating,
    likes: (o.likedBy ?? []).length,
    likedBy: o.likedBy ?? [],
    parentId: o.parentId ?? null,
    replyCount: 0,
    reactions: o.reactions ?? {},
    hasSpoiler: false,
    createdAt: new Date(Date.now() - seq * 1000),
    updatedAt: new Date(),
  });
  return ref.id;
}

async function follow(a: string, b: string) {
  await adminDb().collection('users').doc(a).collection('following').doc(b).set({ followingId: b, createdAt: new Date() });
}

type WallBody = {
  summary: { score: number | null; count: number; distribution: Record<string, number>; friendsSeen: { uid: string }[]; friendsSeenCount: number };
  reviews: Array<{ id: string; userId: string; replies?: { id: string }[]; reactionCounts: Record<string, number>; myReaction: string | null }>;
};

async function getWall(token?: string) {
  const res = await callRoute<WallBody>(wallGet, 'GET', {
    token, params: { tmdbId: String(FILM) }, url: `http://test/api/v1/movies/${FILM}/reviews-wall`,
  });
  if (res.body.ok !== true) throw new Error('wall failed');
  return res.body.data;
}

beforeEach(async () => {
  await clearFirestore();
  me_ = await createTestUser('me');
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  stranger = await createTestUser('stranger');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('wall summary: score + loved/liked/fine/nope distribution + count', async () => {
  await seedReview({ uid: alice.uid, rating: 9 }); // loved
  await seedReview({ uid: bob.uid, rating: 8 }); // loved
  await seedReview({ uid: stranger.uid, rating: 7 }); // liked
  await seedReview({ uid: alice.uid, rating: 6 }); // fine
  await seedReview({ uid: bob.uid, rating: 4 }); // nope

  const wall = await getWall(await me_.getIdToken());
  assert.equal(wall.summary.count, 5, 'five top-level reviews');
  assert.equal(wall.summary.distribution.loved, 2);
  assert.equal(wall.summary.distribution.liked, 1);
  assert.equal(wall.summary.distribution.fine, 1);
  assert.equal(wall.summary.distribution.nope, 1);
  assert.equal(wall.summary.score, 6.8, 'avg of 9,8,7,6,4');
});

test('wall groups replies under their top-level parent', async () => {
  const parent = await seedReview({ uid: alice.uid, rating: 9, text: 'parent' });
  await seedReview({ uid: bob.uid, parentId: parent, text: 'a reply' });

  const wall = await getWall(await me_.getIdToken());
  assert.equal(wall.reviews.length, 1, 'only the top-level review is in the list');
  const top = wall.reviews.find((r) => r.id === parent)!;
  assert.equal(top.replies?.length, 1, 'reply is nested under the parent');
});

test('friends-seen = the follow subset; non-followed still count in the list', async () => {
  await follow(me_.uid, alice.uid);
  await seedReview({ uid: alice.uid, rating: 9, username: 'alice' });
  await seedReview({ uid: stranger.uid, rating: 8, username: 'stranger' });

  const wall = await getWall(await me_.getIdToken());
  assert.equal(wall.summary.count, 2, 'both reviews counted');
  assert.equal(wall.summary.friendsSeenCount, 1, 'only the followed reviewer is a "friend seen"');
  assert.ok(wall.summary.friendsSeen.some((f) => f.uid === alice.uid));
  assert.ok(!wall.summary.friendsSeen.some((f) => f.uid === stranger.uid));
});

test('blocked authors are excluded from the wall', async () => {
  await seedReview({ uid: alice.uid, rating: 9 });
  await seedReview({ uid: bob.uid, rating: 8 });
  await adminDb().collection('blocks').doc(`${me_.uid}_${bob.uid}`).set({ blockerId: me_.uid, blockedId: bob.uid, createdAt: new Date() });

  const wall = await getWall(await me_.getIdToken());
  const uids = wall.reviews.map((r) => r.userId);
  assert.ok(uids.includes(alice.uid));
  assert.ok(!uids.includes(bob.uid), 'blocked bob is excluded');
});

test('wall is readable unauthenticated (no friends-seen / my-state)', async () => {
  await seedReview({ uid: alice.uid, rating: 9 });
  const res = await callRoute<WallBody>(wallGet, 'GET', { params: { tmdbId: String(FILM) }, url: `http://test/api/v1/movies/${FILM}/reviews-wall` });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok) assert.equal(res.body.data.summary.friendsSeenCount, 0);
});

test('react: set → replace (one per user) → remove', async () => {
  const id = await seedReview({ uid: alice.uid, rating: 9 });
  const token = await bob.getIdToken();

  const r1 = await callRoute<{ counts: Record<string, number>; myReaction: string }>(
    reactPost, 'POST', { token, params: { id }, body: { type: 'flame' }, url: `http://test/api/v1/reviews/${id}/react` },
  );
  assert.equal(r1.body.ok, true);
  if (r1.body.ok) { assert.equal(r1.body.data.counts.flame, 1); assert.equal(r1.body.data.myReaction, 'flame'); }

  // replace flame → heart (still one reaction)
  const r2 = await callRoute<{ counts: Record<string, number>; myReaction: string }>(
    reactPost, 'POST', { token, params: { id }, body: { type: 'heart' }, url: `http://test/api/v1/reviews/${id}/react` },
  );
  if (r2.body.ok) {
    assert.equal(r2.body.data.counts.heart, 1);
    assert.ok(!r2.body.data.counts.flame, 'flame replaced, not stacked');
    assert.equal(r2.body.data.myReaction, 'heart');
  }

  // remove
  const r3 = await callRoute<{ counts: Record<string, number>; myReaction: string | null }>(
    reactDelete, 'DELETE', { token, params: { id }, url: `http://test/api/v1/reviews/${id}/react` },
  );
  if (r3.body.ok) { assert.equal(r3.body.data.myReaction, null); assert.ok(!r3.body.data.counts.heart); }
});

test('react: invalid type → 400; unauth → 401', async () => {
  const id = await seedReview({ uid: alice.uid, rating: 9 });
  const bad = await callRoute(reactPost, 'POST', { token: await bob.getIdToken(), params: { id }, body: { type: 'nope' }, url: `http://test/api/v1/reviews/${id}/react` });
  assert.equal(bad.status, 400);
  const unauth = await callRoute(reactPost, 'POST', { params: { id }, body: { type: 'flame' }, url: `http://test/api/v1/reviews/${id}/react` });
  assert.equal(unauth.status, 401);
});

test('reactions counted per type across users on the wall', async () => {
  const id = await seedReview({ uid: alice.uid, rating: 9, reactions: { [stranger.uid]: 'flame', [bob.uid]: 'flame' } });
  const wall = await getWall(await me_.getIdToken());
  const top = wall.reviews.find((r) => r.id === id)!;
  assert.equal(top.reactionCounts.flame, 2, 'two flame reactions counted');
  assert.equal(top.myReaction, null, 'caller has not reacted');
});
