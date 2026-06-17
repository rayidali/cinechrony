/**
 * Phase 0.7.5.4 — hot-takes (the home "green quote card").
 *
 * `GET /api/v1/reviews/highlights` returns a GLOBAL pool of short, high-rated,
 * top-level reviews, minus the caller's own takes + blocked authors, de-duped to
 * one per film. Real data only — an empty pool returns []. The server cache is
 * bypassed under the emulator, so each call builds fresh and these assert the
 * selection rule + per-caller filtering directly.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as highlightsGet } from '@/app/api/v1/reviews/highlights/route';

let me_: TestUser, alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

type SeedReview = {
  uid: string;
  text: string;
  rating?: number | null;
  tmdbId?: number;
  parentId?: string | null;
  username?: string;
  daysAgo?: number;
};

/** Seed a /reviews doc. Defaults to a valid hot-take (top-level, rating 9). */
async function seedReview(o: SeedReview) {
  seq += 1;
  const tmdbId = o.tmdbId ?? 100 + seq;
  await adminDb().collection('reviews').add({
    tmdbId,
    mediaType: 'movie',
    movieTitle: `film ${tmdbId}`,
    moviePosterUrl: null,
    userId: o.uid,
    username: o.username ?? o.uid,
    userDisplayName: o.username ?? o.uid,
    userPhotoUrl: null,
    text: o.text,
    ratingAtTime: o.rating === undefined ? 9 : o.rating,
    likes: 0,
    likedBy: [],
    parentId: o.parentId ?? null,
    replyCount: 0,
    // unique, descending createdAt so ordering is deterministic
    createdAt: new Date(Date.now() - (o.daysAgo ?? 0) * DAY - seq * 1000),
    updatedAt: new Date(),
  });
}

async function highlights(token: string) {
  const res = await callRoute<{
    highlights: Array<{ reviewId: string; tmdbId: number; text: string; author: { uid: string } }>;
  }>(highlightsGet, 'GET', { token, url: 'http://test/api/v1/reviews/highlights' });
  if (res.body.ok !== true) throw new Error('highlights failed');
  return res.body.data.highlights;
}

beforeEach(async () => {
  await clearFirestore();
  me_ = await createTestUser('me');
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('GET /reviews/highlights: unauth → 401', async () => {
  const res = await callRoute(highlightsGet, 'GET', { url: 'http://test/api/v1/reviews/highlights' });
  assert.equal(res.status, 401);
});

test('surfaces short, high-rated, top-level reviews from others', async () => {
  await seedReview({ uid: alice.uid, username: 'alice', tmdbId: 1, text: 'perfect bear, no notes whatsoever', rating: 9 });
  const out = await highlights(await me_.getIdToken());
  assert.ok(out.some((h) => h.tmdbId === 1 && h.author.uid === alice.uid), "alice's rave appears");
});

test('excludes replies, low-rated, and out-of-length takes', async () => {
  await seedReview({ uid: alice.uid, tmdbId: 1, text: 'a perfectly good high rated take here', rating: 9 }); // keep
  await seedReview({ uid: alice.uid, tmdbId: 2, text: 'a reply that should never surface', rating: 9, parentId: 'someparent' });
  await seedReview({ uid: alice.uid, tmdbId: 3, text: 'mid film honestly not great at all', rating: 5 }); // low rating
  await seedReview({ uid: alice.uid, tmdbId: 4, text: 'ok', rating: 9 }); // too short
  await seedReview({ uid: alice.uid, tmdbId: 5, text: 'x'.repeat(300), rating: 9 }); // too long
  await seedReview({ uid: alice.uid, tmdbId: 6, text: 'a great take with no rating attached', rating: null }); // no rating

  const out = await highlights(await me_.getIdToken());
  const ids = out.map((h) => h.tmdbId);
  assert.ok(ids.includes(1), 'the valid take is kept');
  assert.ok(!ids.includes(2), 'replies excluded');
  assert.ok(!ids.includes(3), 'low-rated excluded');
  assert.ok(!ids.includes(4), 'too-short excluded');
  assert.ok(!ids.includes(5), 'too-long excluded');
  assert.ok(!ids.includes(6), 'unrated excluded');
});

test('excludes the caller’s own takes', async () => {
  await seedReview({ uid: me_.uid, tmdbId: 1, text: 'my own glowing take goes here', rating: 10 });
  await seedReview({ uid: alice.uid, tmdbId: 2, text: 'alice glowing take goes right here', rating: 10 });
  const out = await highlights(await me_.getIdToken());
  const uids = out.map((h) => h.author.uid);
  assert.ok(!uids.includes(me_.uid), 'own take excluded');
  assert.ok(uids.includes(alice.uid), "others' take included");
});

test('excludes blocked authors', async () => {
  await seedReview({ uid: alice.uid, tmdbId: 1, text: 'alice has a fine take right here', rating: 9 });
  await seedReview({ uid: bob.uid, tmdbId: 2, text: 'bob has a fine take right here too', rating: 9 });
  await adminDb().collection('blocks').doc(`${me_.uid}_${bob.uid}`)
    .set({ blockerId: me_.uid, blockedId: bob.uid, createdAt: new Date() });
  const out = await highlights(await me_.getIdToken());
  const uids = out.map((h) => h.author.uid);
  assert.ok(uids.includes(alice.uid));
  assert.ok(!uids.includes(bob.uid), 'blocked bob excluded');
});

test('one take per film (dedupe by tmdbId)', async () => {
  await seedReview({ uid: alice.uid, tmdbId: 7, text: 'first great take for this film', rating: 9, daysAgo: 0 });
  await seedReview({ uid: bob.uid, tmdbId: 7, text: 'second great take same film here', rating: 10, daysAgo: 1 });
  const out = await highlights(await me_.getIdToken());
  assert.equal(out.filter((h) => h.tmdbId === 7).length, 1, 'only one take per film');
});

test('empty when there are no qualifying reviews', async () => {
  await seedReview({ uid: alice.uid, tmdbId: 1, text: 'meh', rating: 4 }); // low + short
  const out = await highlights(await me_.getIdToken());
  assert.equal(out.length, 0, 'no qualifying takes → empty (card hides)');
});
