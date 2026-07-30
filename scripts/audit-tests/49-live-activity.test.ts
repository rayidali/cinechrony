/**
 * Live Activity server plumbing (LIVE-ACTIVITY-PLAN.md P1) — the claims and
 * ordering that make the lock-screen scan tracker safe over at-most-once
 * APNs delivery:
 *   - token registration routes (auth, validation, owner checks)
 *   - push-to-start fires exactly once per job (even under concurrent emits)
 *   - stage updates ride the update token, strictly monotonic
 *   - the late-arriving update token FLUSHES current state (incl. resolving
 *     an already-finished job's card — read-repair)
 *   - the terminal transition is TWO pushes in a fixed order: an ALERTING
 *     `update` carrying the finished state (the buzz), then a silent `end`
 *     (closes the activity, sets the dismissal-date). An `alert` on an `end`
 *     event is Apple-Watch-only, so an alerting end reaches nobody on iPhone —
 *     that mistake shipped twice; see `ExtractionPushResult` for the postmortem
 *   - the terminal claim ends the card exactly once, and NEVER at the cost of
 *     the completion push: the push is the durable Notification Center record
 *     (a Live Activity alert leaves none), delivered silently when the card
 *     already buzzed so there is exactly one ding per scan
 *   - the one surviving suppression is a live surface polling at the moment the
 *     scan finishes: then the card resolves but NOTHING announces it
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
  sendLiveActivityFinalAlert,
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

// ── Alerting: the terminal update never bangs ────────────────────────────
// An alerting ActivityKit terminal update was the 07-26 fix for "the scan
// result never notified me" and it did not work in the field (three scans,
// `trace=end:ok`, owner perceived nothing) — it leaves no Notification Center
// entry, so a pocketed phone loses the event. See `ExtractionPushResult`.

test('sendLiveActivityEnd is always silent — an alert on an `end` event is Apple-Watch-only', async () => {
  await sendLiveActivityEnd(UPDATE_TOKEN, 'production', { stage: 4, label: '1 film found', detail: null, state: 'done' });
  const end = sent.at(-1)!;
  assert.equal(end.aps.event, 'end');
  assert.equal(end.aps.alert, undefined,
    'an alerting end reads as working (APNs 200) and reaches nobody on iPhone');
  assert.ok(end.aps['dismissal-date'], 'the resolved card still lingers on the lock screen');
});

test('sendLiveActivityFinalAlert alerts on an `update` event — the one iOS actually presents', async () => {
  await sendLiveActivityFinalAlert(
    UPDATE_TOKEN, 'production',
    { stage: 4, label: '4 films found', detail: 'Heat (1995) · imdb 8.3', state: 'done' },
    { title: 'cinechrony', body: '4 films hiding in one reel.' },
  );
  const final = sent.at(-1)!;
  // THE FIX for the two-round "the completion never buzzes" bug: same alert
  // dictionary the working push-to-start uses, carried on `update`, NOT `end`.
  assert.equal(final.aps.event, 'update', 'must be an update — alerts are ignored on end');
  assert.deepEqual(final.aps.alert, {
    title: 'cinechrony', body: '4 films hiding in one reel.', sound: 'default',
  });
  const cs = final.aps['content-state'] as { state: string; label: string };
  assert.equal(cs.state, 'done', 'it carries the FINISHED state, not a working one');
  assert.equal(cs.label, '4 films found');
  assert.equal(final.aps['dismissal-date'], undefined, 'dismissal rides the end push');
});

// ── Terminal: the card resolves once, and it never replaces the ding ─────

test('a confirmed activity: alerting UPDATE then quiet end, and the push still goes (silently)', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-terminal');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Party', year: '1984', imdbRating: '7.4' }],
  });
  // THE REGRESSION GUARD for both rounds of the bug: this used to return
  // 'skipped_live_activity' and send nothing (round 1), and before that the card
  // resolved with no alert anyone could perceive (round 0). Now: the card buzzes,
  // and the push is still delivered as the durable Notification Center record.
  assert.equal(result, 'sent_silent', 'card owns the buzz, push owns the receipt');

  // The buzz is an alerting UPDATE carrying the terminal state.
  const finals = sent.filter((s) => s.aps.event === 'update' && s.aps.alert);
  assert.equal(finals.length, 1, 'exactly one alerting update per scan');
  const fcs = finals[0].aps['content-state'] as { label: string; detail: string; state: string };
  assert.equal(fcs.state, 'done');
  assert.equal(fcs.label, '1 film found');
  assert.match(fcs.detail, /Party \(1984\) · imdb 7\.4/);
  assert.match((finals[0].aps.alert as { body: string }).body, /Party/);

  // …followed by a silent end that closes the activity.
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1);
  assert.equal((ends[0].aps['content-state'] as { state: string }).state, 'done');
  assert.equal(ends[0].aps.alert, undefined, 'the end never alerts — it cannot');
  assert.ok(
    sent.findIndex((s) => s.aps.event === 'update' && s.aps.alert)
      < sent.findIndex((s) => s.aps.event === 'end'),
    'the alert must be sent BEFORE the end, or the activity is closed when it lands',
  );

  const data = (await ref.get()).data();
  assert.ok(data?.pushSentAt, 'the one terminal-notify claim is taken');
  assert.ok(data?.liveActivity?.endedAt, 'the end claim is taken');
  assert.equal(data?.pushResult, 'sent_silent', 'the branch is stamped for observability');

  const again = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, {
    kind: 'films', films: [{ title: 'Party', year: '1984', imdbRating: '7.4' }],
  });
  assert.equal(again, 'skipped_duplicate');
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 're-entry can never end twice');
});

test('a live watcher: the card resolves but nothing buzzes', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-watched');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  await ref.update({ lastPolledAt: Timestamp.now() }); // the drawer is polling

  const result = await sendExtractionCompletionPush(adminDb(), ref, jobId, me_.uid, { kind: 'zero' });
  // The ONLY surviving suppression: a live surface is rendering the reveal on
  // screen this second, so a ding would land on top of what it announces. The
  // extension disarms this on dismiss (`detachExtraction`), and the web /extract
  // screen now does the same on unmount, precisely so walking away can't buy
  // silence.
  assert.equal(result, 'skipped_watched');
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1,
    'the lock-screen card must resolve even while the drawer is open');
  assert.equal(ends[0].aps.alert, undefined, 'never an alerting end, watched or not');
  assert.equal(
    sent.filter((s) => s.aps.alert && s.aps.event === 'update').length, 0,
    'and no alerting update either — resolving the card is not announcing it',
  );
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
  assert.equal(ends[0].aps.alert, undefined, 'the push already landed — the card just catches up, quietly');

  // A repeated attach (token rotation) must not re-end.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  assert.equal(sent.filter((s) => s.aps.event === 'end').length, 1, 'endedAt claim holds');
});

test('a late update token resolves a watched job\'s card quietly too', async () => {
  const startToken = await registerStartToken();
  const { jobId, ref } = await seedJob('la-late-token-watched');
  await emitScanActivity(adminDb(), ref, jobId, startToken, 1, 'getting the video');
  // No update token attached yet, but a live surface WAS polling when the job
  // finished — the completion push claims pushSentAt and skips the ding
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

  // The token lands late. Resolve the dangling card, but stay quiet: this route
  // is only ever called BY the app, so the reveal is already on screen. The
  // deliberate tradeoff — the only path to zero notifications is "a live
  // surface was open at the moment the scan finished", which is the one case
  // where the user is looking straight at the answer.
  await attachExtractionLiveActivityToken(me_.uid, jobId, 'activity-1', UPDATE_TOKEN);
  const ends = sent.filter((s) => s.aps.event === 'end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].aps.alert, undefined, 'no alerting end, ever');
  assert.equal((ends[0].aps['content-state'] as { state: string }).state, 'done');
});
