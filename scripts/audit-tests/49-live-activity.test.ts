/**
 * Live Activity server plumbing (LIVE-ACTIVITY-PLAN.md P1) — the claims and
 * ordering that make the lock-screen scan tracker safe over at-most-once
 * APNs delivery:
 *   - token registration routes (auth, validation, owner checks)
 *   - push-to-start fires exactly once per job (even under concurrent emits)
 *   - stage updates ride the update token, strictly monotonic
 *   - the late-arriving update token FLUSHES current state (incl. resolving
 *     an already-finished job's card — read-repair)
 *   - the terminal claim ends the card once and suppresses the FCM ding
 *     ('skipped_live_activity'), and the drawer's live-watcher suppression
 *     still resolves the card
 * APNs is swapped for a recording transport — these assert the STATE
 * MACHINE, not Apple.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as registerTokenRoute } from '@/app/api/v1/me/live-activity-token/route';
import { POST as attachTokenRoute } from '@/app/api/v1/extractions/[jobId]/live-activity-token/route';
import {
  createExtraction as createExtractionFn,
  sendExtractionCompletionPush,
  attachExtractionLiveActivityToken,
  emitScanActivity,
} from '@/lib/extraction-server';
import {
  __setLiveActivityTransportForTests,
  getLiveActivityStartToken,
} from '@/lib/live-activity-server';
import { Timestamp } from 'firebase-admin/firestore';

type SentPush = { env: string; deviceToken: string; aps: Record<string, unknown> };
let sent: SentPush[] = [];

let me_: TestUser, other: TestUser;
let meTok: string, otherTok: string;

before(() => {
  setupTestEnv();
  // Configure the feature (isLiveActivityConfigured gates on these)…
  process.env.APNS_KEY_ID = 'TESTKEY123';
  process.env.APNS_PRIVATE_KEY = 'not-a-real-key';
  // …and record sends instead of talking to Apple (also skips JWT minting).
  __setLiveActivityTransportForTests(async (env, deviceToken, _headers, body) => {
    sent.push({ env, deviceToken, aps: (JSON.parse(body) as { aps: Record<string, unknown> }).aps });
    return { status: 200, body: '' };
  });
});

after(() => {
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_PRIVATE_KEY;
  __setLiveActivityTransportForTests(null);
});

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  sent = [];
  me_ = await createTestUser('me');
  other = await createTestUser('other');
  meTok = await me_.getIdToken();
  otherTok = await other.getIdToken();
});

const DEVICE = 'device-test-0001';
const P2S_TOKEN = 'ab'.repeat(32); // a plausible 64-hex push-to-start token
const UPDATE_TOKEN = 'cd'.repeat(32);

async function seedJob(slug: string) {
  const { jobId } = await createExtractionFn(me_.uid, `https://www.tiktok.com/@x/video/${slug}`);
  return { jobId, ref: adminDb().doc(`extraction_jobs/${jobId}`) };
}

async function registerStartToken() {
  const res = await callRoute(registerTokenRoute, 'POST', {
    token: meTok, body: { deviceId: DEVICE, token: P2S_TOKEN },
  });
  assert.equal(res.status, 200);
  const startToken = await getLiveActivityStartToken(adminDb(), me_.uid);
  assert.ok(startToken, 'registered token is retrievable');
  return startToken!;
}

// ── Token registration route ─────────────────────────────────────────────

test('push-to-start token registration requires auth', async () => {
  const res = await callRoute(registerTokenRoute, 'POST', { body: { deviceId: DEVICE, token: P2S_TOKEN } });
  assert.equal(res.status, 401);
});

test('push-to-start token registration validates and saves', async () => {
  const bad = await callRoute(registerTokenRoute, 'POST', {
    token: meTok, body: { deviceId: DEVICE, token: 'zzz not hex' },
  });
  assert.equal(bad.status, 400, 'garbage tokens are rejected');

  await registerStartToken();
  const doc = await adminDb().doc(`users/${me_.uid}/laTokens/${DEVICE}`).get();
  assert.equal(doc.data()?.token, P2S_TOKEN);
  assert.equal(doc.data()?.platform, 'ios');
});

// ── Start claim ──────────────────────────────────────────────────────────

test('push-to-start fires exactly once per job, even under concurrent emits', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-start-once');

  await Promise.all([
    emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video'),
    emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video'),
  ]);

  const starts = sent.filter((s) => s.aps.event === 'start');
  assert.equal(starts.length, 1, 'the requestedAt claim admits exactly one start');
  assert.equal(starts[0].deviceToken, P2S_TOKEN);
  assert.equal(starts[0].aps['attributes-type'], 'ScanActivityAttributes');
  assert.deepEqual(starts[0].aps.attributes, { jobId });

  const la = (await ref.get()).data()?.liveActivity;
  assert.ok(la?.requestedAt, 'start claimed');
  assert.equal(la?.lastStageSent, 1);
  assert.equal(la?.env, 'production', 'the environment that accepted the send is remembered');
});

test('a user with no registered token gets no activity and no claims', async () => {
  const { jobId, ref } = await seedJob('la-no-token');
  const startToken = await getLiveActivityStartToken(adminDb(), me_.uid);
  assert.equal(startToken, null);
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  assert.equal(sent.length, 0);
  assert.equal((await ref.get()).data()?.liveActivity, undefined);
});

// ── The token handshake + monotonic stage updates ────────────────────────

test('stage updates wait for the update token, then flush and stay monotonic', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-handshake');

  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  // Update token hasn't arrived yet — stage 2 has nowhere to go (accepted
  // by design; full-state pushes make the next one repair the miss).
  await emitScanActivity(adminDb(), ref, jobId, startToken, 2, 'watching it');
  assert.equal(sent.filter((s) => s.aps.event === 'update').length, 0);

  // The app reports the update token mid-scan → the CURRENT state flushes.
  await ref.update({ stage: 'watching' });
  const attach = await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  assert.equal(attach.attached, true);
  let updates = sent.filter((s) => s.aps.event === 'update');
  assert.equal(updates.length, 1, 'attach flushes the freshest state');
  assert.equal(updates[0].deviceToken, UPDATE_TOKEN);
  assert.equal((updates[0].aps['content-state'] as { stage: number }).stage, 2);

  // Later stages now ride the token…
  await emitScanActivity(adminDb(), ref, jobId, startToken, 3, 'matching films');
  updates = sent.filter((s) => s.aps.event === 'update');
  assert.equal(updates.length, 2);
  assert.equal((updates[1].aps['content-state'] as { stage: number }).stage, 3);

  // …and a replayed ordinal is refused (self-heal re-entry can't regress the card).
  await emitScanActivity(adminDb(), ref, jobId, startToken, 3, 'matching films');
  assert.equal(sent.filter((s) => s.aps.event === 'update').length, 2, 'ordinal must strictly increase');
});

test('attach route: 401 unauthenticated, 403 for a non-owner', async () => {
  const { jobId } = await seedJob('la-attach-auth');
  const noAuth = await callRoute(attachTokenRoute, 'POST', {
    params: { jobId }, body: { activityId: 'a', token: UPDATE_TOKEN },
  });
  assert.equal(noAuth.status, 401);
  const wrongUser = await callRoute(attachTokenRoute, 'POST', {
    token: otherTok, params: { jobId }, body: { activityId: 'a', token: UPDATE_TOKEN },
  });
  assert.equal(wrongUser.status, 403, 'someone else\'s activity token cannot attach to my job');
});

// ── Terminal: the card resolves once, and it replaces the ding ───────────

test('a confirmed activity carries the result: end push sent, FCM ding suppressed', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-terminal');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Party', year: '1984', imdbRating: '7.4' }],
  });
  assert.equal(result, 'skipped_live_activity', 'the card IS the notification');

  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1);
  const cs = ends[0].aps['content-state'] as { label: string; detail: string; state: string };
  assert.equal(cs.state, 'done');
  assert.equal(cs.label, '1 film found');
  assert.match(cs.detail, /Party \(1984\) · imdb 7\.4/);

  const data = (await ref.get()).data();
  assert.ok(data?.pushSentAt, 'the one terminal-notify claim is taken');
  assert.ok(data?.liveActivity?.endedAt, 'the end claim is taken');

  const again = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Party', year: '1984', imdbRating: '7.4' }],
  });
  assert.equal(again, 'skipped_duplicate');
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 're-entry can never end twice');
});

test('a live watcher still gets the card resolved, just no ding', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-watched');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  await ref.update({ lastPolledAt: Timestamp.now() }); // the drawer is polling

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'zero' });
  assert.equal(result, 'skipped_watched');
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1,
    'the lock-screen card must resolve even while the drawer is open');
});

// ── Read-repair: the token arrives after the job already finished ────────

test('a late update token resolves an already-finished card, exactly once', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-late-token');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');

  // The pipeline finished (and its terminal push went out as plain FCM,
  // since no update token existed at the time)…
  await ref.update({
    status: 'done', stage: 'done',
    films: [{ tmdbId: 1, title: 'Heat', year: '1995', mediaType: 'movie', imdbRating: '8.3' }],
  });
  const push = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Heat', year: '1995', imdbRating: '8.3' }],
  });
  assert.equal(push, 'sent', 'no confirmed activity → the outcome push is the fallback');

  // …then the token finally lands: the dangling card resolves NOW.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1, 'attach on a terminal job ends the card');
  assert.equal((ends[0].aps['content-state'] as { state: string }).state, 'done');

  // A repeated attach (token rotation) must not re-end.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 'endedAt claim holds');
});
