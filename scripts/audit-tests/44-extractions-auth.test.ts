/**
 * Phase C.1a — film-extraction backend (auth · ownership · validation · rate
 * limit · cache). The pipeline is stubbed (fixture films) so these assert the
 * job/cache/auth machinery, NOT the AI:
 *   - POST/GET require auth (401)
 *   - malformed / unsupported (non-TikTok/IG/YouTube) URLs → 400
 *   - a supported URL creates a job
 *   - GET returns the OWNER their job, 403s anyone else, 404s a missing one
 *   - the burst rate-limit (5/min) trips on the 6th call (429)
 *   - an identical URL resolves from the shared cache as `done`
 *   - the completion-push `pushSentAt` claim never fires twice for one job,
 *     and is suppressed (but still claimed) while a live poller is watching
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createExtraction } from '@/app/api/v1/extractions/route';
import { GET as getExtraction } from '@/app/api/v1/extractions/[jobId]/route';
import {
  runExtractionPipeline, createExtraction as createExtractionFn, sendExtractionCompletionPush, detachExtraction,
} from '@/lib/extraction-server';

let me_: TestUser, other: TestUser;
let meTok: string, otherTok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  me_ = await createTestUser('me');
  other = await createTestUser('other');
  meTok = await me_.getIdToken();
  otherTok = await other.getIdToken();
});

const TIKTOK = 'https://www.tiktok.com/@x/video/123';

test('POST requires auth', async () => {
  const res = await callRoute(createExtraction, 'POST', { body: { url: TIKTOK } });
  assert.equal(res.status, 401);
});

test('POST rejects a malformed url', async () => {
  const res = await callRoute(createExtraction, 'POST', { token: meTok, body: { url: 'not a url' } });
  assert.equal(res.status, 400);
});

test('POST rejects an unsupported host', async () => {
  const res = await callRoute(createExtraction, 'POST', { token: meTok, body: { url: 'https://example.com/whatever' } });
  assert.equal(res.status, 400);
});

test('POST a supported url creates a job', async () => {
  const res = await callRoute<{ jobId: string; status: string }>(createExtraction, 'POST', {
    token: meTok, body: { url: TIKTOK },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok) {
    assert.ok(res.body.data.jobId, 'returns a jobId');
    assert.ok(['processing', 'done'].includes(res.body.data.status));
  }
});

test('GET returns the owner their job', async () => {
  const created = await callRoute<{ jobId: string }>(createExtraction, 'POST', { token: meTok, body: { url: TIKTOK } });
  const jobId = created.body.ok ? created.body.data.jobId : '';
  const res = await callRoute(getExtraction, 'GET', {
    token: meTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}`,
  });
  assert.equal(res.status, 200);
});

test('GET forbids another user', async () => {
  const created = await callRoute<{ jobId: string }>(createExtraction, 'POST', { token: meTok, body: { url: TIKTOK } });
  const jobId = created.body.ok ? created.body.data.jobId : '';
  const res = await callRoute(getExtraction, 'GET', {
    token: otherTok, params: { jobId }, url: `http://test/api/v1/extractions/${jobId}`,
  });
  assert.equal(res.status, 403);
});

test('GET 404s a missing job', async () => {
  const res = await callRoute(getExtraction, 'GET', {
    token: meTok, params: { jobId: 'does-not-exist' },
    url: 'http://test/api/v1/extractions/does-not-exist',
  });
  assert.equal(res.status, 404);
});

test('GET requires auth', async () => {
  const res = await callRoute(getExtraction, 'GET', {
    params: { jobId: 'x' }, url: 'http://test/api/v1/extractions/x',
  });
  assert.equal(res.status, 401);
});

test('burst rate limit trips on the 6th call', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await callRoute(createExtraction, 'POST', {
      token: meTok, body: { url: `https://www.tiktok.com/@x/video/${i}` },
    });
    assert.equal(r.status, 200, `call ${i} should be allowed`);
  }
  const sixth = await callRoute(createExtraction, 'POST', {
    token: meTok, body: { url: 'https://www.tiktok.com/@x/video/sixth' },
  });
  assert.equal(sixth.status, 429, 'the 6th call within the window is rate-limited');
});

test('concurrent scans of the same video dedupe (one pipeline; follower self-heals from cache)', async () => {
  const url = 'https://www.tiktok.com/@x/video/stampede';
  const winner = await createExtractionFn(me_.uid, url); // claims the urlHash
  const follower = await createExtractionFn(me_.uid, url); // claim is live → follows
  assert.notEqual(winner.jobId, follower.jobId);
  assert.equal(winner.status, 'processing');
  assert.equal(follower.status, 'processing');

  // Run ONLY the winner's pipeline (the follower never kicked one).
  await runExtractionPipeline(winner.jobId);

  // The follower resolves from the SHARED cache on its next poll (self-heal).
  const fRes = await callRoute<{ status: string; films?: unknown[] }>(getExtraction, 'GET', {
    token: meTok, params: { jobId: follower.jobId }, url: `http://test/api/v1/extractions/${follower.jobId}`,
  });
  assert.equal(fRes.body.ok, true);
  if (fRes.body.ok) {
    assert.equal(fRes.body.data.status, 'done', 'follower resolved from cache');
    assert.ok((fRes.body.data.films?.length ?? 0) > 0, 'follower got the films');
  }
});

test('an identical url resolves from cache as done', async () => {
  const url = 'https://www.tiktok.com/@y/video/777';
  const first = await callRoute<{ jobId: string }>(createExtraction, 'POST', { token: meTok, body: { url } });
  const jobId = first.body.ok ? first.body.data.jobId : '';
  assert.ok(jobId, 'first POST created a job');
  // Run the (stubbed) pipeline directly to populate the shared cache.
  await runExtractionPipeline(jobId);

  const second = await callRoute<{ status: string }>(createExtraction, 'POST', { token: meTok, body: { url } });
  assert.equal(second.body.ok, true);
  if (second.body.ok) assert.equal(second.body.data.status, 'done', 'cache hit → done');
});

test('completion push fires at most once per job (pushSentAt guards re-entry)', async () => {
  const { jobId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-guard');
  const ref = adminDb().doc(`extraction_jobs/${jobId}`);

  // Exercises the same claim `runRealPipeline` uses at completion — no
  // Gemini/Apify needed, this only asserts the idempotency guard. No
  // lastPolledAt has been stamped yet, so this is a normal 'sent'.
  const TWO_FILMS = { kind: 'films' as const, films: [{ title: 'Party', year: '1984' }, { title: 'Heat', year: '1995' }] };
  const firstResult = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, TWO_FILMS);
  assert.equal(firstResult, 'sent');
  const first = (await ref.get()).data()?.pushSentAt;
  assert.ok(first, 'first call claims pushSentAt');

  const secondResult = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, TWO_FILMS);
  assert.equal(secondResult, 'skipped_duplicate');
  const second = (await ref.get()).data()?.pushSentAt;
  assert.equal(
    second?.toMillis?.(), first?.toMillis?.(),
    'second call is a no-op — pushSentAt unchanged, so the push can never fire twice',
  );
});

test('zero-film and failed outcomes also push (closure for a closed drawer)', async () => {
  const { jobId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-zero');
  const ref = adminDb().doc(`extraction_jobs/${jobId}`);
  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'zero' });
  assert.equal(result, 'sent', 'a zero-film scan still tells the user it finished');
  assert.ok((await ref.get()).data()?.pushSentAt, 'zero outcome claims pushSentAt');

  const { jobId: failedId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-failed');
  const failedRef = adminDb().doc(`extraction_jobs/${failedId}`);
  const failedResult = await sendExtractionCompletionPush(adminDb(), failedRef, failedId, me_.uid, { kind: 'failed' });
  assert.equal(failedResult, 'sent', 'a failed scan pings instead of going silent');
  assert.ok((await failedRef.get()).data()?.pushSentAt, 'failed outcome claims pushSentAt');
});

test('completion push is skipped (but pushSentAt still claimed) when lastPolledAt is fresh', async () => {
  const { jobId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-watched');
  const ref = adminDb().doc(`extraction_jobs/${jobId}`);
  // The owner's poll loop (share-extension drawer / `/extract` screen) just
  // hit GET /api/v1/extractions/[jobId], which stamped this.
  await ref.update({ lastPolledAt: Timestamp.now() });

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'films', films: [{ title: 'Heat' }, { title: 'Ran' }] });
  assert.equal(result, 'skipped_watched', 'a live watcher suppresses the ding');

  const snap = await ref.get();
  assert.ok(snap.data()?.pushSentAt, 'pushSentAt is still claimed so no later re-entry can send');
});

test('detach disarms the live-watcher suppression (closed drawer → ping fires)', async () => {
  const { jobId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-detach');
  const ref = adminDb().doc(`extraction_jobs/${jobId}`);
  // Drawer was polling seconds ago…
  await ref.update({ lastPolledAt: Timestamp.now() });
  // …then the user closed it: the drawer fires detach on the way out.
  const detach = await detachExtraction(me_.uid, jobId);
  assert.equal(detach.detached, true);
  assert.equal((await ref.get()).data()?.lastPolledAt, undefined, 'lastPolledAt cleared');

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'films', films: [{ title: 'Party', year: '1984' }] });
  assert.equal(result, 'sent', 'no live watcher left — the push fires');
});

test('completion push sends when lastPolledAt is stale or absent', async () => {
  const { jobId } = await createExtractionFn(me_.uid, 'https://www.tiktok.com/@x/video/push-stale');
  const ref = adminDb().doc(`extraction_jobs/${jobId}`);
  // Stale: older than the LIVE_WATCH_WINDOW_MS (20s) sendExtractionCompletionPush checks.
  await ref.update({ lastPolledAt: Timestamp.fromMillis(Date.now() - 30_000) });

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'films', films: [{ title: 'Heat' }, { title: 'Ran' }, { title: 'Party' }] });
  assert.equal(result, 'sent', 'a stale lastPolledAt does not suppress the push');

  const snap = await ref.get();
  assert.ok(snap.data()?.pushSentAt, 'pushSentAt claimed');
});
