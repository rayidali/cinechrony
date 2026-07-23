/**
 * Suite 52 — the weekly scan quota (free tier: 7 fresh scans/week, Monday
 * 00:00 UTC reset, stored server-only on `users_private/{uid}.scanUsage`).
 * Only a CLAIM (a fresh Apify+Gemini pipeline run) costs money — cache hits
 * and followers must stay free and must never touch the counter:
 *   - a fresh claim writes `scanUsage`
 *   - the 8th distinct claim in a week rejects (429 QUOTA_EXCEEDED)
 *   - a cache hit succeeds even with the quota exhausted, usage unchanged
 *   - a follower (live foreign claim) succeeds even with the quota exhausted
 *   - a stale week key resets the counter instead of accumulating
 *   - an unrecognized `plan` string still gets the free limit
 *   - a quota-rejected claim never poisons the cache — another user can still
 *     scan the same url
 * Mirrors 44-extractions-auth.test.ts's harness conventions.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createExtraction } from '@/app/api/v1/extractions/route';
import {
  createExtraction as createExtractionFn, canonicalizeUrl, currentWeekKey,
} from '@/lib/extraction-server';
import { QuotaExceededError } from '@/lib/api-handler';

let me_: TestUser, other: TestUser;
let meTok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  me_ = await createTestUser('me');
  other = await createTestUser('other');
  meTok = await me_.getIdToken();
});

/** N distinct TikTok urls — distinct urls hash to distinct cache docs, so
 *  each one is its own claim (no cache-hit/follower short-circuit). */
const distinctUrls = (n: number, seed = 'quota') =>
  Array.from({ length: n }, (_, i) => `https://www.tiktok.com/@x/video/${seed}-${i}`);

/** The urlHash `createExtraction` keys the shared cache doc under, mirroring
 *  the private `hashUrl()` in extraction-server.ts. */
function urlHashFor(rawUrl: string): string {
  const canon = canonicalizeUrl(rawUrl);
  assert.ok(canon, 'test url must canonicalize');
  return createHash('sha256').update(canon!.canonicalUrl).digest('hex');
}

async function privDoc(uid: string) {
  return (await adminDb().doc(`users_private/${uid}`).get()).data();
}

test('a fresh scan claims the quota — scanUsage becomes { week, used: 1 }', async () => {
  const res = await createExtractionFn(me_.uid, distinctUrls(1)[0]);
  assert.equal(res.status, 'processing', 'a fresh url claims and runs the pipeline');
  const priv = await privDoc(me_.uid);
  assert.deepEqual(priv?.scanUsage, { week: currentWeekKey(), used: 1 });
});

test('the 8th distinct claim in a week rejects with 429 QUOTA_EXCEEDED', async () => {
  const urls = distinctUrls(8);
  for (const url of urls.slice(0, 7)) {
    const res = await createExtractionFn(me_.uid, url); // direct call — bypasses the route's burst limiter
    assert.equal(res.status, 'processing');
  }
  const priv = await privDoc(me_.uid);
  assert.equal(priv?.scanUsage?.used, 7, 'all 7 free claims spent');

  // The 8th goes through the route so the HTTP status/error-code mapping is
  // asserted the same way suite 44 asserts its rate-limit 429.
  const res = await callRoute(createExtraction, 'POST', { token: meTok, body: { url: urls[7] } });
  assert.equal(res.status, 429);
  assert.equal(res.body.ok, false);
  if (!res.body.ok) assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');

  const privAfter = await privDoc(me_.uid);
  assert.equal(privAfter?.scanUsage?.used, 7, 'the rejected 8th call never incremented usage');
});

test('quota exhausted + a cache-hit url still succeeds as done, usage unchanged', async () => {
  await adminDb().doc(`users_private/${me_.uid}`).set({
    scanUsage: { week: currentWeekKey(), used: 7 },
  });

  const cacheUrl = 'https://www.tiktok.com/@x/video/cache-hit';
  const canon = canonicalizeUrl(cacheUrl)!;
  await adminDb().doc(`extraction_cache/${urlHashFor(cacheUrl)}`).set({
    status: 'done',
    films: [{ tmdbId: 949, title: 'Heat', year: '1995', mediaType: 'movie', posterUrl: null, confidence: 0.95, evidence: null }],
    suggestedListName: 'crime classics',
    isFilmContent: true,
    videoThumbnail: null,
    canonicalUrl: canon.canonicalUrl,
    provider: canon.provider,
    createdAt: Timestamp.now(),
  });

  const res = await createExtractionFn(me_.uid, cacheUrl);
  assert.equal(res.status, 'done', 'a cache hit is free — it never touches the quota gate');

  const priv = await privDoc(me_.uid);
  assert.equal(priv?.scanUsage?.used, 7, 'usage untouched by a cache-hit resolve');
});

test('quota exhausted + a live foreign claim still succeeds as a follower, usage unchanged', async () => {
  await adminDb().doc(`users_private/${me_.uid}`).set({
    scanUsage: { week: currentWeekKey(), used: 7 },
  });

  const followUrl = 'https://www.tiktok.com/@x/video/live-claim';
  const canon = canonicalizeUrl(followUrl)!;
  await adminDb().doc(`extraction_cache/${urlHashFor(followUrl)}`).set({
    status: 'processing',
    startedAt: Timestamp.now(), // fresh — the claim is still live
    canonicalUrl: canon.canonicalUrl,
    provider: canon.provider,
  });

  const res = await createExtractionFn(me_.uid, followUrl);
  assert.equal(res.status, 'processing', 'joins the live claim instead of erroring');

  const job = (await adminDb().doc(`extraction_jobs/${res.jobId}`).get()).data();
  assert.equal(job?.follower, true, 'resolved as a follower, not a rejected claimant');

  const priv = await privDoc(me_.uid);
  assert.equal(priv?.scanUsage?.used, 7, 'following someone else\'s claim never spends the quota');
});

test('a stale week key resets the counter instead of accumulating', async () => {
  await adminDb().doc(`users_private/${me_.uid}`).set({
    scanUsage: { week: '2020-01-06', used: 999 },
  });

  const res = await createExtractionFn(me_.uid, distinctUrls(1, 'stale-week')[0]);
  assert.equal(res.status, 'processing', 'a stale week never blocks the scan');

  const priv = await privDoc(me_.uid);
  assert.deepEqual(priv?.scanUsage, { week: currentWeekKey(), used: 1 }, 'the counter reset instead of adding onto the old week');
});

test('an unrecognized plan string still gets the free weekly limit', async () => {
  await adminDb().doc(`users_private/${me_.uid}`).set({
    plan: 'made_up_plan_xyz',
    scanUsage: { week: currentWeekKey(), used: 7 },
  });

  const res = await callRoute(createExtraction, 'POST', {
    token: meTok, body: { url: distinctUrls(1, 'unknown-plan')[0] },
  });
  assert.equal(res.status, 429, 'an unrecognized plan does not bypass the free-tier cap');
  assert.equal(res.body.ok, false);
  if (!res.body.ok) assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');
});

test('a quota-rejected claim never poisons the cache — a different user can still scan it', async () => {
  await adminDb().doc(`users_private/${me_.uid}`).set({
    scanUsage: { week: currentWeekKey(), used: 7 },
  });

  const sharedUrl = distinctUrls(1, 'not-poisoned')[0];
  await assert.rejects(
    () => createExtractionFn(me_.uid, sharedUrl),
    (err: unknown) => {
      assert.ok(err instanceof QuotaExceededError);
      assert.equal(err.code, 'QUOTA_EXCEEDED');
      assert.equal(err.status, 429);
      return true;
    },
  );

  const cacheSnap = await adminDb().doc(`extraction_cache/${urlHashFor(sharedUrl)}`).get();
  assert.equal(cacheSnap.exists, false, 'the rejected claim left no cache doc behind');

  // Someone else with budget can scan the exact same url immediately.
  const res = await createExtractionFn(other.uid, sharedUrl);
  assert.equal(res.status, 'processing', 'a different caller still claims it fresh');
});
