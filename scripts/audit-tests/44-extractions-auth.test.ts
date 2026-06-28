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
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createExtraction } from '@/app/api/v1/extractions/route';
import { GET as getExtraction } from '@/app/api/v1/extractions/[jobId]/route';
import { runExtractionPipeline, createExtraction as createExtractionFn } from '@/lib/extraction-server';

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
