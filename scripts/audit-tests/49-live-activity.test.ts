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
 *   - the terminal end push is an ALERTING update (banner + sound) so a
 *     resolved card is a moment the user notices, not a silent lock-screen
 *     edit; a mid-scan stage update carries no alert at all
 *   - a late-arriving token that resolves an already-notified job ('sent')
 *     stays quiet — no second ding stacked on the one that already fired
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
  sendLiveActivityEnd,
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

// ── Alerting: the terminal update bangs, mid-scan updates stay quiet ─────

test('sendLiveActivityEnd: alert (+ sound) rides the end push when given, omitted when not', async () => {
  await sendLiveActivityEnd(UPDATE_TOKEN, 'production', { stage: 4, label: '1 film found', detail: null, state: 'done' }, {
    title: 'cinechrony', body: 'found it. Heat (1995).',
  });
  const withAlert = sent.at(-1)!;
  assert.deepEqual(withAlert.aps.alert, { title: 'cinechrony', body: 'found it. Heat (1995).', sound: 'default' });

  await sendLiveActivityEnd(UPDATE_TOKEN, 'production', { stage: 4, label: '1 film found', detail: null, state: 'done' });
  const withoutAlert = sent.at(-1)!;
  assert.equal(withoutAlert.aps.alert, undefined, 'a caller that omits alert gets a quiet resolve');
});

// ── Terminal: the card resolves once, and it replaces the ding ───────────

test('a confirmed activity carries the result: alerting end push sent, FCM ding suppressed', async () => {
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

  // The card resolving is now a LOUD moment: an ActivityKit alerting update
  // (banner + sound), same brand-voice copy the FCM fallback would have used.
  const alert = ends[0].aps.alert as { title: string; body: string; sound: string };
  assert.equal(alert.title, 'cinechrony');
  assert.match(alert.body, /Party/, 'the alert names the film, same as the FCM copy would');
  assert.equal(alert.sound, 'default');

  const data = (await ref.get()).data();
  assert.ok(data?.pushSentAt, 'the one terminal-notify claim is taken');
  assert.ok(data?.liveActivity?.endedAt, 'the end claim is taken');
  assert.equal(data?.pushResult, 'skipped_live_activity', 'the branch is stamped for observability');

  const again = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Party', year: '1984', imdbRating: '7.4' }],
  });
  assert.equal(again, 'skipped_duplicate');
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 're-entry can never end twice');
});

test('a live watcher: FCM stays suppressed, but the card still alerts once', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-watched');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  await ref.update({ lastPolledAt: Timestamp.now() }); // the drawer is polling

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'zero' });
  assert.equal(result, 'skipped_watched');
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1,
    'the lock-screen card must resolve even while the drawer is open');
  // The Live Activity is a distinct surface (lock screen / Dynamic Island)
  // from whatever's polling — it still gets its one alert, only the
  // redundant in-app-adjacent FCM ding is what "watched" suppresses.
  assert.ok(ends[0].aps.alert, 'the card alerts regardless of the watched-FCM suppression');
});

// ── Read-repair: the token arrives after the job already finished ────────

test('a late update token resolves an already-notified card quietly (no second ding)', async () => {
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
  assert.equal((await ref.get()).data()?.pushResult, 'sent', 'the branch is stamped');

  // …then the token finally lands: the dangling card resolves NOW, but the
  // user already got the FCM ding for this job — a second alert here would
  // be a duplicate notification for one completed scan.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1, 'attach on a terminal job ends the card');
  assert.equal((ends[0].aps['content-state'] as { state: string }).state, 'done');
  assert.equal(ends[0].aps.alert, undefined, 'pushResult was already "sent" — the card resolves quietly');

  // A repeated attach (token rotation) must not re-end.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 'endedAt claim holds');
});

test('a late update token DOES announce when nobody was told yet (watched → drawer closed → token lands)', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-late-token-watched');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  // No update token attached yet, but the drawer WAS polling when the job
  // finished — the completion push claims pushSentAt and skips the FCM ding
  // ('skipped_watched'), and there's no card to resolve yet either.
  await ref.update({
    status: 'done', stage: 'done', lastPolledAt: Timestamp.now(),
    films: [{ tmdbId: 1, title: 'Ran', year: '1985', mediaType: 'movie', imdbRating: '8.3' }],
  });
  const push = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Ran', year: '1985', imdbRating: '8.3' }],
  });
  assert.equal(push, 'skipped_watched');
  assert.equal((await ref.get()).data()?.pushResult, 'skipped_watched');

  // The token lands after the drawer's long gone — nobody has ever been told
  // this scan finished, so the late card resolve is the user's one notice.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1);
  const alert = ends[0].aps.alert as { title: string; body: string; sound: string } | undefined;
  assert.ok(alert, 'skipped_watched never actually notified anyone — this is the one alert');
  assert.match(alert!.body, /Ran/);
  assert.equal(alert!.sound, 'default');
});
