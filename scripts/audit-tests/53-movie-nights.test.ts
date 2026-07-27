/**
 * Movie Night — S1 server core (MOVIE-NIGHT-PLAN.md).
 *
 * Covers `movie-nights-server.ts` + its routes:
 *   - create: doc shape, host auto-'in', shareCode present, invitee
 *     notification fan-out; rejects a past datetime; caps invitees at 9
 *     (MAX_PEOPLE - 1); drops an ineligible invitee (not a list member AND
 *     not followed) silently, no error; drops a blocked invitee silently
 *     AND skips their notification
 *   - getMovieNight: 403 for a stranger
 *   - rsvp: updates counts + notifies the host; 403 for a non-invitee
 *   - reschedule: 403 for a non-host; resets `reminderSentAt` + stamps
 *     `previousScheduledFor`
 *   - cancel: notifies the other invitees
 *   - complete: watch docs for every attendee (`watchedAt` = the night's
 *     `scheduledFor`), the caller's rating applied, second call idempotent
 *   - upcoming: returns the night for an invitee, not for a stranger
 *
 * NOTE: the Firestore emulator does not enforce composite indexes, so
 * `getUpcomingMovieNights`'s array-contains + equality + range query runs
 * fine here even though `firestore.indexes.json` needs a deploy in prod.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createRoute } from '@/app/api/v1/movie-nights/route';
import { GET as upcomingRoute } from '@/app/api/v1/movie-nights/upcoming/route';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/v1/movie-nights/[id]/route';
import { POST as rsvpRoute } from '@/app/api/v1/movie-nights/[id]/rsvp/route';
import { POST as completeRoute } from '@/app/api/v1/movie-nights/[id]/complete/route';
import { GET as listMovieNightRoute } from '@/app/api/v1/lists/[ownerId]/[listId]/movie-night/route';
import { MAX_PEOPLE } from '@/lib/movie-nights-server';
import type { MovieNightView, MovieNightPinView } from '@/lib/movie-night-types';

let host: TestUser, invitee1: TestUser, stranger: TestUser;
let hostTok: string, invitee1Tok: string, strangerTok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  host = await createTestUser('host');
  invitee1 = await createTestUser('invitee1');
  stranger = await createTestUser('stranger');
  hostTok = await host.getIdToken();
  invitee1Tok = await invitee1.getIdToken();
  strangerTok = await stranger.getIdToken();
  // Minimal profile docs — logWatch's review upsert (exercised by `complete`)
  // needs a real users/{uid} doc, matching the convention in
  // 42-watches-endpoints.test.ts / 45-post-visibility-watch.test.ts.
  await Promise.all([host, invitee1, stranger].map((u) =>
    adminDb().collection('users').doc(u.uid).set({ uid: u.uid, username: u.uid.slice(0, 8), usernameLower: u.uid.slice(0, 8) }),
  ));
  // host follows invitee1 — the eligibility path used by most tests below.
  await follow(host.uid, invitee1.uid);
});

// ─── Fixtures + helpers ────────────────────────────────────────────────────

const FILM = { tmdbId: 550, mediaType: 'movie' as const, title: 'Fight Club', year: '1999', posterUrl: null, runtime: 139 };

function futureIso(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}
function pastIso(hoursAgo = 2): string {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString();
}

/** Writes a follow edge directly — doesn't require the target to be a real
 *  auth user (getFollowingIds only reads doc ids). */
async function follow(followerUid: string, targetUid: string): Promise<void> {
  await adminDb().doc(`users/${followerUid}/following/${targetUid}`).set({
    followerId: followerUid, followingId: targetUid, createdAt: new Date(),
  });
  await adminDb().doc(`users/${targetUid}/followers/${followerUid}`).set({
    followerId: followerUid, followingId: targetUid, createdAt: new Date(),
  });
}

async function block(blockerUid: string, blockedUid: string): Promise<void> {
  await adminDb().doc(`blocks/${blockerUid}_${blockedUid}`).set({
    blockerId: blockerUid, blockedId: blockedUid, createdAt: new Date(),
  });
}

async function createNight(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: MovieNightView | undefined; night: MovieNightView | undefined }> {
  const res = await callRoute<MovieNightView>(createRoute, 'POST', {
    token,
    body: { film: FILM, scheduledFor: futureIso(), inviteeUids: [invitee1.uid], ...overrides },
  });
  return { status: res.status, body: res.body.ok ? res.body.data : undefined, night: res.body.ok ? res.body.data : undefined };
}

async function notificationsFor(uid: string, type?: string) {
  const snap = await adminDb().collection('notifications').where('userId', '==', uid).get();
  const docs = snap.docs.map((d) => d.data());
  return type ? docs.filter((d) => d.type === type) : docs;
}

/** A minimal public list doc — enough for `getListMovieNight`'s ownership +
 *  visibility gate (F5/F4 tests only need the pin route, not a real list
 *  feature surface). */
async function seedPublicList(ownerId: string, listId = 'pin-list'): Promise<void> {
  await adminDb().doc(`users/${ownerId}/lists/${listId}`).set({
    id: listId, name: 'movie night list', ownerId, isPublic: true, collaboratorIds: [], movieCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

// ─── createMovieNight ──────────────────────────────────────────────────────

test('create: happy path — doc shape, host auto-in, shareCode, invitee notified', async () => {
  const { status, night } = await createNight(hostTok);
  assert.equal(status, 200);
  assert.ok(night);
  if (!night) return;

  assert.equal(night.hostUid, host.uid);
  assert.equal(night.status, 'proposed');
  assert.deepEqual(night.film, FILM);
  assert.ok(typeof night.shareCode === 'string' && night.shareCode.length > 0, 'shareCode present for the host');
  assert.equal(night.previousScheduledFor, null);

  const hostRow = night.invitees.find((i) => i.uid === host.uid);
  const inviteeRow = night.invitees.find((i) => i.uid === invitee1.uid);
  assert.ok(hostRow?.isHost, 'host is flagged isHost');
  assert.equal(hostRow?.answer, 'in', 'host auto-RSVPs in');
  assert.equal(inviteeRow?.answer, null, 'invitee has not answered yet');
  assert.equal(night.counts.going, 1);
  assert.equal(night.counts.waiting, 1);

  const notifs = await notificationsFor(invitee1.uid, 'movie_night_invite');
  assert.equal(notifs.length, 1, 'invitee got a movie_night_invite notification');
  assert.equal(notifs[0].nightId, night.id);
  assert.equal(notifs[0].fromUserId, host.uid);

  // Host is never notified of their own creation.
  const hostNotifs = await notificationsFor(host.uid, 'movie_night_invite');
  assert.equal(hostNotifs.length, 0);
});

test('create: rejects a past datetime', async () => {
  const res = await callRoute(createRoute, 'POST', {
    token: hostTok, body: { film: FILM, scheduledFor: pastIso(), inviteeUids: [invitee1.uid] },
  });
  assert.equal(res.status, 400);
});

test('create: caps invitees at MAX_PEOPLE - 1 (9 others)', async () => {
  const fakeUids = Array.from({ length: 11 }, (_, i) => `fake-invitee-${i + 1}`);
  await Promise.all(fakeUids.map((uid) => follow(host.uid, uid)));

  const { status, night } = await createNight(hostTok, { inviteeUids: fakeUids });
  assert.equal(status, 200);
  assert.ok(night);
  if (!night) return;

  assert.equal(night.invitees.length, MAX_PEOPLE, 'host + 9 others, never more');
  const invitedFakeIds = night.invitees.map((i) => i.uid).filter((uid) => uid.startsWith('fake-invitee-'));
  assert.equal(invitedFakeIds.length, MAX_PEOPLE - 1);
  // The overflow (10th/11th in submission order) never made it in.
  assert.ok(!night.invitees.some((i) => i.uid === 'fake-invitee-10'));
  assert.ok(!night.invitees.some((i) => i.uid === 'fake-invitee-11'));
});

test('create: an invitee who is neither a list member nor followed is silently dropped', async () => {
  const { status, night } = await createNight(hostTok, { inviteeUids: [invitee1.uid, stranger.uid] });
  assert.equal(status, 200);
  assert.ok(night);
  if (!night) return;

  assert.ok(night.invitees.some((i) => i.uid === invitee1.uid), 'followed invitee made it in');
  assert.ok(!night.invitees.some((i) => i.uid === stranger.uid), 'unreachable invitee dropped, not rejected');
});

test('create: a blocked invitee is silently dropped AND never notified', async () => {
  await block(host.uid, stranger.uid);
  await follow(host.uid, stranger.uid); // followed AND blocked — block wins

  const { status, night } = await createNight(hostTok, { inviteeUids: [invitee1.uid, stranger.uid] });
  assert.equal(status, 200);
  assert.ok(night);
  if (!night) return;

  assert.ok(!night.invitees.some((i) => i.uid === stranger.uid), 'blocked invitee dropped');
  const notifs = await notificationsFor(stranger.uid, 'movie_night_invite');
  assert.equal(notifs.length, 0, 'blocked invitee gets no notification');
});

// T3 (F4) — create idempotency via clientKey.
test('create: two creates with the same clientKey return the SAME night, one doc', async () => {
  const clientKey = 'idempotency-test-key-0001';
  const first = await callRoute<MovieNightView>(createRoute, 'POST', {
    token: hostTok, body: { film: FILM, scheduledFor: futureIso(), inviteeUids: [invitee1.uid], clientKey },
  });
  assert.equal(first.status, 200);
  assert.ok(first.body.ok);
  if (!first.body.ok) return;

  const second = await callRoute<MovieNightView>(createRoute, 'POST', {
    token: hostTok, body: { film: FILM, scheduledFor: futureIso(48), inviteeUids: [invitee1.uid], clientKey },
  });
  assert.equal(second.status, 200);
  assert.ok(second.body.ok);
  if (!second.body.ok) return;

  assert.equal(second.body.data.id, first.body.data.id, 'the retry returns the SAME night id, not a new one');

  const all = await adminDb().collection('movie_nights').where('hostUid', '==', host.uid).get();
  assert.equal(all.size, 1, 'exactly one night doc was created');
});

test('create: a DIFFERENT clientKey (or none) still creates a new night', async () => {
  const first = await createNight(hostTok, { clientKey: 'key-a-00000000' });
  assert.ok(first.night);
  const second = await createNight(hostTok, { clientKey: 'key-b-00000000' });
  assert.ok(second.night);
  if (!first.night || !second.night) return;
  assert.notEqual(first.night.id, second.night.id, 'different keys never collide');

  const all = await adminDb().collection('movie_nights').where('hostUid', '==', host.uid).get();
  assert.equal(all.size, 2);
});

// ─── getMovieNight ─────────────────────────────────────────────────────────

test('getMovieNight: 403 for a stranger', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;
  const res = await callRoute(getRoute, 'GET', {
    token: strangerTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
  });
  assert.equal(res.status, 403);
});

// T5 (F6) — retroactive blocks: host↔invitee hides the whole night for that
// invitee; a co-invitee↔co-invitee block only filters the pair from each
// other's invitees[], counts stay aggregate.
test('blocks: a host-blocked invitee loses access; a co-invitee block filters the pair, not the counts', async () => {
  const invitee2 = await createTestUser('invitee2b');
  const invitee2Tok = await invitee2.getIdToken();
  await adminDb().collection('users').doc(invitee2.uid).set({
    uid: invitee2.uid, username: invitee2.uid.slice(0, 8), usernameLower: invitee2.uid.slice(0, 8),
  });
  await follow(host.uid, invitee2.uid);

  const { night } = await createNight(hostTok, { inviteeUids: [invitee1.uid, invitee2.uid] });
  assert.ok(night);
  if (!night) return;

  // Host blocks invitee1 AFTER the invite went out (the "retroactive" case).
  await block(host.uid, invitee1.uid);

  const upcoming = await callRoute<MovieNightView[]>(upcomingRoute, 'GET', { token: invitee1Tok });
  assert.ok(upcoming.body.ok);
  if (upcoming.body.ok) {
    assert.ok(!upcoming.body.data.some((n) => n.id === night.id), 'blocked invitee no longer sees it in upcoming');
  }

  const getRes = await callRoute(getRoute, 'GET', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
  });
  assert.equal(getRes.status, 404, 'blocked invitee gets not-found, not forbidden — no existence oracle');

  const rsvpRes = await callRoute(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'in' },
  });
  assert.equal(rsvpRes.status, 404, 'blocked invitee cannot rsvp either — same not-found');

  // Co-invitee pair block: invitee2 blocks invitee1 — NEITHER is the host.
  await block(invitee2.uid, invitee1.uid);

  const invitee2View = await callRoute<MovieNightView>(getRoute, 'GET', {
    token: invitee2Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
  });
  assert.equal(invitee2View.status, 200, 'invitee2 still has access — this pair block never hides the whole night');
  assert.ok(invitee2View.body.ok);
  if (invitee2View.body.ok) {
    const view = invitee2View.body.data;
    assert.ok(!view.invitees.some((i) => i.uid === invitee1.uid), 'invitee1 filtered out of invitee2 view');
    assert.ok(view.invitees.some((i) => i.uid === invitee2.uid), 'invitee2 still sees themselves');
    assert.ok(view.invitees.some((i) => i.uid === host.uid), 'invitee2 still sees the host');
    const total = view.counts.going + view.counts.maybe + view.counts.out + view.counts.waiting;
    assert.equal(total, 3, 'counts stay AGGREGATE — all 3 invitees (host+invitee1+invitee2), unaffected by the filter');
  }
});

// ─── rsvpMovieNight ────────────────────────────────────────────────────────

test('rsvp: updates counts and notifies the host', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightView>(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'maybe' },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (!res.body.ok) return;
  assert.equal(res.body.data.counts.maybe, 1);
  assert.equal(res.body.data.counts.waiting, 0);
  const inviteeRow = res.body.data.invitees.find((i) => i.uid === invitee1.uid);
  assert.equal(inviteeRow?.answer, 'maybe');

  const notifs = await notificationsFor(host.uid, 'movie_night_rsvp');
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].fromUserId, invitee1.uid);
});

test('rsvp: 403 for a non-invitee', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;
  const res = await callRoute(rsvpRoute, 'POST', {
    token: strangerTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'in' },
  });
  assert.equal(res.status, 403);
});

// ─── updateMovieNight — reschedule / cancel ─────────────────────────────────

test('reschedule: 403 for a non-host', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;
  const res = await callRoute(patchRoute, 'PATCH', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: futureIso(48) },
  });
  assert.equal(res.status, 403);
});

test('reschedule: resets reminderSentAt and stamps previousScheduledFor', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  // Simulate the S2 ticker having already sent the reminder for the original time.
  await adminDb().doc(`movie_nights/${night.id}`).update({ reminderSentAt: Timestamp.now() });

  const newTime = futureIso(72);
  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: newTime },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (!res.body.ok) return;
  assert.equal(res.body.data.previousScheduledFor, night.scheduledFor);
  assert.equal(res.body.data.status, 'proposed');
  assert.equal(
    new Date(res.body.data.scheduledFor).toISOString(),
    new Date(newTime).toISOString(),
  );

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.reminderSentAt, null, 'reminderSentAt reset to null');

  const notifs = await notificationsFor(invitee1.uid, 'movie_night_time_changed');
  assert.equal(notifs.length, 1);
});

test('cancel: notifies the other invitees', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'cancel' },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (!res.body.ok) return;
  assert.equal(res.body.data.status, 'cancelled');

  const notifs = await notificationsFor(invitee1.uid, 'movie_night_cancelled');
  assert.equal(notifs.length, 1);
  const hostNotifs = await notificationsFor(host.uid, 'movie_night_cancelled');
  assert.equal(hostNotifs.length, 0, 'host never notifies itself');
});

// T2 (F3) — reschedule/cancel must guard status === 'proposed' exactly like
// didnt_happen already does.
test('reschedule and cancel against a completed night both 400; status stays completed', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  const pastMs = Date.now() - 3 * 3600_000;
  await adminDb().doc(`movie_nights/${night.id}`).update({ scheduledFor: Timestamp.fromMillis(pastMs) });

  const completeRes = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body: { attendeeUids: [host.uid] },
  });
  assert.equal(completeRes.status, 200);

  const rescheduleRes = await callRoute(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: futureIso(48) },
  });
  assert.equal(rescheduleRes.status, 400, 'reschedule against a completed night is rejected');

  const cancelRes = await callRoute(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'cancel' },
  });
  assert.equal(cancelRes.status, 400, 'cancel against a completed night is rejected');

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.status, 'completed', 'status was never disturbed by either rejected attempt');
});

// ─── completeMovieNight ──────────────────────────────────────────────────────

test('complete: watch docs for every attendee, caller rating applied, idempotent on re-call', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  // F8 — an attendee must have answered 'in'/'maybe' to be eligible at all
  // (the caller is exempt from this, but invitee1 here is not the caller).
  await callRoute(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'in' },
  });

  // Force the night into the past so it's completable.
  const pastMs = Date.now() - 3 * 3600_000;
  await adminDb().doc(`movie_nights/${night.id}`).update({ scheduledFor: Timestamp.fromMillis(pastMs) });

  const body = { attendeeUids: [host.uid, invitee1.uid], rating: 8, note: 'so good' };
  const res = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (!res.body.ok) return;
  assert.equal(res.body.data.status, 'completed');
  assert.deepEqual(res.body.data.completion?.attendeeUids.sort(), [host.uid, invitee1.uid].sort());

  const hostWatches = await adminDb().collection(`users/${host.uid}/watches`).get();
  const inviteeWatches = await adminDb().collection(`users/${invitee1.uid}/watches`).get();
  assert.equal(hostWatches.size, 1, 'one watch entry for the host (caller)');
  assert.equal(inviteeWatches.size, 1, 'one watch entry for the other attendee');
  assert.equal(hostWatches.docs[0].data().watchedAt.toMillis(), pastMs, "watchedAt = the night's scheduledFor");
  assert.equal(inviteeWatches.docs[0].data().watchedAt.toMillis(), pastMs);
  assert.equal(hostWatches.docs[0].data().rating, 8, "caller's rating applied");
  assert.equal(inviteeWatches.docs[0].data().rating, null, 'other attendee is not auto-rated');

  const morningAfterNotifs = await notificationsFor(invitee1.uid, 'movie_night_morning_after');
  assert.equal(morningAfterNotifs.length, 1);

  // Second call, same body — idempotent: no duplicate watch docs, still success.
  const second = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body,
  });
  assert.equal(second.status, 200);
  assert.ok(second.body.ok);
  if (!second.body.ok) return;
  assert.equal(second.body.data.status, 'completed');

  const hostWatches2 = await adminDb().collection(`users/${host.uid}/watches`).get();
  const inviteeWatches2 = await adminDb().collection(`users/${invitee1.uid}/watches`).get();
  assert.equal(hostWatches2.size, 1, 'no duplicate watch for the host on re-call');
  assert.equal(inviteeWatches2.size, 1, 'no duplicate watch for the other attendee on re-call');

  const morningAfterNotifs2 = await notificationsFor(invitee1.uid, 'movie_night_morning_after');
  assert.equal(morningAfterNotifs2.length, 1, 'no duplicate morning-after notification on re-call');
});

// T1 (F2) — a SECOND attendee rating the night later (after the host already
// completed it) updates THEIR OWN watch in place instead of duplicating it.
test('complete: a second attendee rating later updates their own watch in place, not a duplicate', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  // invitee1 must be 'in'/'maybe' to be an eligible attendee at all (F8).
  await callRoute(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'in' },
  });

  const pastMs = Date.now() - 3 * 3600_000;
  await adminDb().doc(`movie_nights/${night.id}`).update({ scheduledFor: Timestamp.fromMillis(pastMs) });

  // A completes with rating 8 (attendees A+B) — the fresh path fans a
  // (rating: null) watch out to B too.
  const aComplete = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body: { attendeeUids: [host.uid, invitee1.uid], rating: 8 },
  });
  assert.equal(aComplete.status, 200);

  // B completes with rating 7 — the night is already 'completed', so this
  // rides the 'already' branch and should update B's EXISTING watch.
  const bComplete = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body: { attendeeUids: [host.uid, invitee1.uid], rating: 7 },
  });
  assert.equal(bComplete.status, 200);

  const hostWatches = await adminDb().collection(`users/${host.uid}/watches`).get();
  const inviteeWatches = await adminDb().collection(`users/${invitee1.uid}/watches`).get();
  assert.equal(hostWatches.size, 1, 'A still has exactly one watch doc');
  assert.equal(inviteeWatches.size, 1, 'B has EXACTLY ONE watch doc for the film — updated in place, not duplicated');
  assert.equal(inviteeWatches.docs[0].data().rating, 7, "B's own rating landed on their existing watch");
  assert.equal(hostWatches.docs[0].data().rating, 8, "A's rating is untouched by B's later call");
});

// T7 (F8) — attendeeUids is filtered to invitees whose CURRENT rsvp is
// 'in'/'maybe'; an 'out' invitee slipped into the request body gets no watch.
test('complete: an "out" invitee included in attendeeUids gets NO watch doc', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  await callRoute(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'out' },
  });

  const pastMs = Date.now() - 3 * 3600_000;
  await adminDb().doc(`movie_nights/${night.id}`).update({ scheduledFor: Timestamp.fromMillis(pastMs) });

  const res = await callRoute<MovieNightView>(completeRoute, 'POST', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/complete`,
    body: { attendeeUids: [host.uid, invitee1.uid] },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (res.body.ok) {
    assert.ok(
      !res.body.data.completion?.attendeeUids.includes(invitee1.uid),
      "the 'out' invitee never made it into completion.attendeeUids",
    );
  }

  const inviteeWatches = await adminDb().collection(`users/${invitee1.uid}/watches`).get();
  assert.equal(inviteeWatches.size, 0, "the 'out' invitee gets no watch doc at all");
});

// T4 (F5) — the list-pin route returns the redacted shape to a stranger AND
// an unauthenticated caller; the invitee still gets the full view.
test('list-pin route: stranger + unauthenticated caller get the redacted pin; invitee gets the full view', async () => {
  await seedPublicList(host.uid);
  const { night } = await createNight(hostTok, { listId: 'pin-list', listOwnerId: host.uid });
  assert.ok(night);
  if (!night) return;

  const strangerRes = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: strangerTok, params: { ownerId: host.uid, listId: 'pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/pin-list/movie-night`,
  });
  assert.equal(strangerRes.status, 200);
  assert.ok(strangerRes.body.ok);
  if (strangerRes.body.ok) {
    const json = JSON.stringify(strangerRes.body.data);
    assert.ok(!json.includes(host.uid), 'stranger response has no host uid');
    assert.ok(!json.includes(invitee1.uid), 'stranger response has no invitee uid');
    assert.ok(!('invitees' in (strangerRes.body.data as object)), 'no invitees array');
    assert.ok(!('guestRsvps' in (strangerRes.body.data as object)), 'no guestRsvps array');
    assert.ok(!('shareCode' in (strangerRes.body.data as object)), 'no shareCode');
    assert.ok(!('hostUid' in (strangerRes.body.data as object)), 'no hostUid field');
    assert.equal(strangerRes.body.data.counts.going, 1, 'aggregate counts are still there — the card needs them');
  }

  const anonRes = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    params: { ownerId: host.uid, listId: 'pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/pin-list/movie-night`,
  });
  assert.equal(anonRes.status, 200);
  assert.ok(anonRes.body.ok);
  if (anonRes.body.ok) {
    const json = JSON.stringify(anonRes.body.data);
    assert.ok(!json.includes(host.uid), 'anonymous response has no host uid either');
    assert.ok(!('shareCode' in (anonRes.body.data as object)));
  }

  const inviteeRes = await callRoute<MovieNightView>(listMovieNightRoute, 'GET', {
    token: invitee1Tok, params: { ownerId: host.uid, listId: 'pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/pin-list/movie-night`,
  });
  assert.equal(inviteeRes.status, 200);
  assert.ok(inviteeRes.body.ok);
  if (inviteeRes.body.ok) {
    assert.ok('invitees' in (inviteeRes.body.data as object), 'the invitee gets the full view');
    assert.equal(inviteeRes.body.data.hostUid, host.uid);
    assert.ok(inviteeRes.body.data.invitees.some((i) => i.uid === invitee1.uid));
  }
});

// ─── private vs public movie nights ─────────────────────────────────────────
//
// Host-controlled `visibility`. A missing field (every legacy doc) reads as
// 'public'; a private night is invisible via `getListMovieNight` to anyone
// but its host/invitees (same `null` as no night existing — no existence
// oracle), including an anonymous caller on a public list. Guest capability
// links (`shared/[code]`, covered in 54-movie-nights-guest.test.ts) are
// UNCHANGED by any of this — holding the share code IS the invitation.

/** A list doc with an explicit collaborator set — the "list member who is
 *  NOT invited to the night" fixture the pin-view gating tests need. */
async function seedListWithCollaborator(
  ownerId: string,
  listId: string,
  collaboratorUid: string,
  isPublic: boolean,
): Promise<void> {
  await adminDb().doc(`users/${ownerId}/lists/${listId}`).set({
    id: listId, name: 'movie night list', ownerId, isPublic, collaboratorIds: [collaboratorUid], movieCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

test('create: visibility defaults to public when omitted', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;
  assert.equal(night.visibility, 'public');
});

test('create: visibility "private" is stored and returned', async () => {
  const { night } = await createNight(hostTok, { visibility: 'private' });
  assert.ok(night);
  if (!night) return;
  assert.equal(night.visibility, 'private');
});

test('create: garbage visibility values (a wrong string, a number, null, an object) fall back to public', async () => {
  for (const bad of ['friends', 123, null, {}, ['private']]) {
    const { night } = await createNight(hostTok, { visibility: bad });
    assert.ok(night, `a night was still created for visibility=${JSON.stringify(bad)}`);
    if (!night) continue;
    assert.equal(night.visibility, 'public', `visibility=${JSON.stringify(bad)} must fall back to public, never reject`);
  }
});

test('getListMovieNight: a PRIVATE night — host and invitee get the full view; a non-invited collaborator and an anonymous caller both get null', async () => {
  const collaborator = await createTestUser('collabnotinv');
  const collaboratorTok = await collaborator.getIdToken();
  await adminDb().collection('users').doc(collaborator.uid).set({
    uid: collaborator.uid, username: collaborator.uid.slice(0, 8), usernameLower: collaborator.uid.slice(0, 8),
  });
  await seedListWithCollaborator(host.uid, 'private-pin-list', collaborator.uid, true);

  const { night } = await createNight(hostTok, {
    listId: 'private-pin-list', listOwnerId: host.uid, visibility: 'private',
  });
  assert.ok(night);
  if (!night) return;
  assert.equal(night.visibility, 'private');

  const hostRes = await callRoute<MovieNightView>(listMovieNightRoute, 'GET', {
    token: hostTok, params: { ownerId: host.uid, listId: 'private-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/private-pin-list/movie-night`,
  });
  assert.equal(hostRes.status, 200);
  assert.ok(hostRes.body.ok);
  if (hostRes.body.ok) assert.ok(hostRes.body.data && 'invitees' in (hostRes.body.data as object), 'the host gets the full view');

  const inviteeRes = await callRoute<MovieNightView>(listMovieNightRoute, 'GET', {
    token: invitee1Tok, params: { ownerId: host.uid, listId: 'private-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/private-pin-list/movie-night`,
  });
  assert.equal(inviteeRes.status, 200);
  assert.ok(inviteeRes.body.ok);
  if (inviteeRes.body.ok) assert.ok(inviteeRes.body.data && 'invitees' in (inviteeRes.body.data as object), 'the invitee gets the full view');

  const collabRes = await callRoute<MovieNightPinView | null>(listMovieNightRoute, 'GET', {
    token: collaboratorTok, params: { ownerId: host.uid, listId: 'private-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/private-pin-list/movie-night`,
  });
  assert.equal(collabRes.status, 200);
  assert.ok(collabRes.body.ok);
  if (collabRes.body.ok) {
    assert.equal(collabRes.body.data, null, 'a list member who was NOT invited gets null, not the redacted pin — no existence oracle');
  }

  const anonRes = await callRoute<MovieNightPinView | null>(listMovieNightRoute, 'GET', {
    params: { ownerId: host.uid, listId: 'private-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/private-pin-list/movie-night`,
  });
  assert.equal(anonRes.status, 200);
  assert.ok(anonRes.body.ok);
  if (anonRes.body.ok) {
    assert.equal(anonRes.body.data, null, 'an anonymous caller on a PUBLIC list still gets null for a PRIVATE night');
  }
});

test('getListMovieNight: a PUBLIC night still shows the redacted pin to a non-invited collaborator (existing behavior intact)', async () => {
  const collaborator = await createTestUser('collabpublic');
  const collaboratorTok = await collaborator.getIdToken();
  await adminDb().collection('users').doc(collaborator.uid).set({
    uid: collaborator.uid, username: collaborator.uid.slice(0, 8), usernameLower: collaborator.uid.slice(0, 8),
  });
  await seedListWithCollaborator(host.uid, 'public-pin-list', collaborator.uid, true);

  const { night } = await createNight(hostTok, {
    listId: 'public-pin-list', listOwnerId: host.uid, visibility: 'public',
  });
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: collaboratorTok, params: { ownerId: host.uid, listId: 'public-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/public-pin-list/movie-night`,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (res.body.ok) {
    assert.ok(res.body.data, 'a public night is not hidden from a non-invited collaborator');
    assert.ok(!('invitees' in (res.body.data as object)), 'still the redacted pin shape, not the full view');
  }
});

test('legacy doc with no visibility field behaves as public (never backfilled)', async () => {
  await seedPublicList(host.uid, 'legacy-pin-list');

  const legacyRef = adminDb().collection('movie_nights').doc();
  await legacyRef.set({
    hostUid: host.uid,
    listId: 'legacy-pin-list',
    listOwnerId: host.uid,
    listName: 'movie night list',
    film: FILM,
    scheduledFor: Timestamp.fromDate(new Date(Date.now() + 24 * 3600_000)),
    previousScheduledFor: null,
    tzOffsetMinutes: 0,
    reminderPreset: '2h',
    status: 'proposed',
    inviteeUids: [host.uid],
    invitees: { [host.uid]: { username: host.uid.slice(0, 8), displayName: null, photoURL: null } },
    rsvps: { [host.uid]: { answer: 'in', respondedAt: Timestamp.now() } },
    guestRsvps: {},
    shareCode: 'x'.repeat(20),
    clientKey: null,
    reminderSentAt: null,
    morningAfterSentAt: null,
    completion: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    // Deliberately NO `visibility` field — mirrors every doc written before
    // this field existed.
  });

  const hostView = await callRoute<MovieNightView>(getRoute, 'GET', {
    token: hostTok, params: { id: legacyRef.id }, url: `http://test/api/v1/movie-nights/${legacyRef.id}`,
  });
  assert.equal(hostView.status, 200);
  assert.ok(hostView.body.ok);
  if (hostView.body.ok) assert.equal(hostView.body.data.visibility, 'public', 'an absent field reads as public, not undefined/crash');

  const strangerRes = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: strangerTok, params: { ownerId: host.uid, listId: 'legacy-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/legacy-pin-list/movie-night`,
  });
  assert.equal(strangerRes.status, 200);
  assert.ok(strangerRes.body.ok);
  if (strangerRes.body.ok) {
    assert.ok(strangerRes.body.data, 'a legacy doc with no visibility field is visible on a public list, exactly like an explicit public night');
  }
});

test('updateMovieNight: the host flips visibility; a non-invitee flips between pin/null accordingly (proves cache invalidation); a non-host is rejected', async () => {
  await seedPublicList(host.uid, 'flip-pin-list');
  const { night } = await createNight(hostTok, { listId: 'flip-pin-list', listOwnerId: host.uid });
  assert.ok(night);
  if (!night) return;
  assert.equal(night.visibility, 'public', 'created public by default');

  const beforeRes = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: strangerTok, params: { ownerId: host.uid, listId: 'flip-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/flip-pin-list/movie-night`,
  });
  assert.ok(beforeRes.body.ok);
  if (beforeRes.body.ok) assert.ok(beforeRes.body.data, 'a stranger sees the pin before the flip');

  // A non-host may not touch visibility either — same authz guard as reschedule.
  const rejectRes = await callRoute(patchRoute, 'PATCH', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: night.scheduledFor, visibility: 'private' },
  });
  assert.equal(rejectRes.status, 403, 'a non-host cannot change visibility');

  const flipRes = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: night.scheduledFor, visibility: 'private' },
  });
  assert.equal(flipRes.status, 200);
  assert.ok(flipRes.body.ok);
  if (flipRes.body.ok) assert.equal(flipRes.body.data.visibility, 'private', 'the host successfully flipped it to private');

  // The pin cache is keyed per list and must be dropped on this mutation —
  // the SAME stranger, same list, now gets null instead of a stale pin.
  const afterRes = await callRoute<MovieNightPinView | null>(listMovieNightRoute, 'GET', {
    token: strangerTok, params: { ownerId: host.uid, listId: 'flip-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/flip-pin-list/movie-night`,
  });
  assert.ok(afterRes.body.ok);
  if (afterRes.body.ok) assert.equal(afterRes.body.data, null, 'the stranger gets null right after the flip — cache correctly invalidated');

  const flipBackRes = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: night.scheduledFor, visibility: 'public' },
  });
  assert.equal(flipBackRes.status, 200);
  assert.ok(flipBackRes.body.ok);
  if (flipBackRes.body.ok) assert.equal(flipBackRes.body.data.visibility, 'public');

  const finalRes = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: strangerTok, params: { ownerId: host.uid, listId: 'flip-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/flip-pin-list/movie-night`,
  });
  assert.ok(finalRes.body.ok);
  if (finalRes.body.ok) assert.ok(finalRes.body.data, 'flipping back to public makes the stranger see the pin again');
});

test('updateMovieNight: a plain reschedule (no visibility key sent) never resets an existing private night back to public', async () => {
  await seedPublicList(host.uid, 'no-touch-pin-list');
  const { night } = await createNight(hostTok, {
    listId: 'no-touch-pin-list', listOwnerId: host.uid, visibility: 'private',
  });
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: futureIso(96) }, // no `visibility` key at all
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (res.body.ok) {
    assert.equal(res.body.data.visibility, 'private', 'omitting the key leaves the existing private setting untouched');
  }
});

// ─── the create budget ──────────────────────────────────────────────────────
//
// Two properties, both learned the hard way from an owner who hit the cap in
// a day of device testing: the budget is spent AFTER the idempotency check
// (so a retry that creates nothing costs nothing), and it is shaped as burst
// + daily rather than one flat daily number (so a script can't spend the
// whole thing in ten seconds while a real host waits 24 hours).

test('an idempotent retry does not spend a create from the budget', async () => {
  const key = 'idempotent-budget-key-1';
  const first = await createNight(hostTok, { clientKey: key });
  assert.equal(first.status, 200);
  assert.ok(first.night);
  if (!first.night) return;

  const counterRef = adminDb().doc(`rate_limits/${host.uid}_movieNightCreateDaily`);
  const afterFirst = (await counterRef.get()).data()?.count;
  assert.equal(afterFirst, 1, 'the real create spent one');

  // Same key: a double-tap, or a resend after a dropped response. It returns
  // the SAME night and must not be charged for it — the check sits after the
  // dedup in createMovieNight precisely so this holds.
  const retry = await createNight(hostTok, { clientKey: key });
  assert.equal(retry.status, 200);
  assert.equal(retry.night?.id, first.night.id, 'same night returned');

  const afterRetry = (await counterRef.get()).data()?.count;
  assert.equal(afterRetry, 1, 'the retry created nothing and cost nothing');
});

test('the create budget is burst + daily, not one flat daily number', async () => {
  // A flat daily cap lets an abuser spend everything at once and then locks a
  // real host out until tomorrow — the worst of both. Asserting the SHAPE
  // (not just the numbers) is what stops a future edit collapsing it back.
  const { RATE_LIMITS } = await import('@/lib/rate-limit');
  const burst = RATE_LIMITS.movieNightCreate;
  const daily = RATE_LIMITS.movieNightCreateDaily;

  assert.ok(burst, 'burst bucket exists');
  assert.ok(daily, 'daily bucket exists');
  assert.ok(burst.windowMs <= 60_000, `burst window is per-minute, got ${burst.windowMs}ms`);
  assert.equal(daily.windowMs, 24 * 60 * 60_000, 'daily window is a day');
  assert.ok(
    burst.limit < daily.limit,
    `the burst cap must bite first (${burst.limit} vs ${daily.limit})`,
  );
  assert.ok(
    daily.limit >= 20,
    `a day's worth of real planning must not be a handful, got ${daily.limit}`,
  );
});

test('a spent burst budget 429s the create and writes no night', async () => {
  const before = (await adminDb().collection('movie_nights').get()).size;

  // Exhaust the per-minute bucket directly, then prove the route refuses.
  const { RATE_LIMITS, checkRateLimit } = await import('@/lib/rate-limit');
  for (let i = 0; i < RATE_LIMITS.movieNightCreate.limit; i++) {
    await checkRateLimit(host.uid, 'movieNightCreate');
  }

  const res = await callRoute(createRoute, 'POST', {
    token: hostTok, body: { film: FILM, scheduledFor: futureIso(), inviteeUids: [invitee1.uid] },
  });
  assert.equal(res.status, 429);

  const after = (await adminDb().collection('movie_nights').get()).size;
  assert.equal(after, before, 'a refused create writes nothing');
});

// ─── timeTbd — "the day is set, the showtime isn't" ─────────────────────────
//
// A tbd night still carries a real `scheduledFor` (anchored to 8pm local), so
// every query/index/ordering behaves exactly as before; the flag governs what
// gets RENDERED and how the past-check is applied. The tests that matter most
// are the two asymmetries: an absent/garbage flag must never invent a tbd
// night, and the past-check must drop to DAY resolution for one — otherwise
// "tonight, tbd" dies at 8pm, which is exactly when someone plans one.

/** UTC midnight of the day `at` falls on. With `tzOffsetMinutes: 0` this is
 *  both "already past" (it is <= now for every instant of the day) and "today"
 *  in the night's own local time — the precise pair the day-resolution rule
 *  distinguishes. Deliberately exact-midnight rather than midnight+1min: at
 *  the one ambiguous instant of the day the `<=` past-check still refuses it,
 *  so this construction has no flaky window. */
function startOfUtcDayIso(at: Date = new Date()): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
}

test('create: timeTbd defaults to false when omitted', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;
  assert.equal(night.timeTbd, false);

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.timeTbd, false, 'stored explicitly on every new doc');
});

test('create: timeTbd true is stored and returned', async () => {
  const { night } = await createNight(hostTok, { timeTbd: true });
  assert.ok(night);
  if (!night) return;
  assert.equal(night.timeTbd, true);

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.timeTbd, true);
});

test('create: anything other than boolean true falls back to a real showtime', async () => {
  // Strict on purpose, and asymmetric: a night wrongly marked tbd HIDES a
  // showtime the host actually picked, so the safe direction is "not tbd".
  for (const bad of ['true', 1, 'tbd', {}, null] as unknown[]) {
    const { night } = await createNight(hostTok, { timeTbd: bad, clientKey: undefined });
    assert.ok(night, `create succeeded for ${JSON.stringify(bad)}`);
    if (night) assert.equal(night.timeTbd, false, `${JSON.stringify(bad)} is not tbd`);
  }
});

test('create: a tbd night lands TODAY even past the anchor hour; the same instant without tbd is refused', async () => {
  const todayStart = startOfUtcDayIso();

  // The control: an instant already gone, judged at instant resolution.
  const timed = await callRoute(createRoute, 'POST', {
    token: hostTok,
    body: { film: FILM, scheduledFor: todayStart, tzOffsetMinutes: 0, inviteeUids: [invitee1.uid] },
  });
  assert.equal(timed.status, 400, 'a real showtime that has passed is still refused');

  // The same instant, judged at day resolution because nobody picked an hour.
  const tbd = await callRoute<MovieNightView>(createRoute, 'POST', {
    token: hostTok,
    body: { film: FILM, scheduledFor: todayStart, tzOffsetMinutes: 0, timeTbd: true, inviteeUids: [invitee1.uid] },
  });
  assert.equal(tbd.status, 200, 'a tbd night on today is fine — the day has not passed');
  assert.ok(tbd.body.ok && tbd.body.data.timeTbd);
});

test('create: a tbd night on a day that has already passed is still refused', async () => {
  const yesterday = startOfUtcDayIso(new Date(Date.now() - 24 * 3600_000));
  const res = await callRoute(createRoute, 'POST', {
    token: hostTok,
    body: { film: FILM, scheduledFor: yesterday, tzOffsetMinutes: 0, timeTbd: true, inviteeUids: [invitee1.uid] },
  });
  assert.equal(res.status, 400, 'day resolution is a relaxation, not a removal');
});

test('a legacy doc with no timeTbd field reads as a real showtime (never backfilled)', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  await adminDb().doc(`movie_nights/${night.id}`).update({ timeTbd: FieldValue.delete() });

  const res = await callRoute<MovieNightView>(getRoute, 'GET', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
  });
  assert.ok(res.body.ok);
  if (res.body.ok) assert.equal(res.body.data.timeTbd, false);

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.timeTbd, undefined, 'reading it never writes it back');
});

test('reschedule: picking a real time on a tbd night clears the flag', async () => {
  const { night } = await createNight(hostTok, { timeTbd: true });
  assert.ok(night);
  if (!night) return;
  assert.equal(night.timeTbd, true);

  // This is THE path by which a tbd night becomes a real one — the host has
  // no separate "set the time" surface, so an omitted flag on a reschedule
  // must mean "this is a real showtime" rather than "leave it alone".
  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: futureIso(48) },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (res.body.ok) assert.equal(res.body.data.timeTbd, false);
});

test('reschedule: a tbd night moved to another day stays tbd when the flag is sent', async () => {
  const { night } = await createNight(hostTok, { timeTbd: true });
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    body: { action: 'reschedule', scheduledFor: futureIso(96), timeTbd: true },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (res.body.ok) assert.equal(res.body.data.timeTbd, true);
});

test('reschedule: a real night can be turned tbd, and today stays legal once it is', async () => {
  const { night } = await createNight(hostTok, { tzOffsetMinutes: 0 });
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightView>(patchRoute, 'PATCH', {
    token: hostTok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}`,
    // The stored tzOffsetMinutes (0) is what the day-check uses — a reschedule
    // body never carries one, which is why that check runs inside the txn.
    body: { action: 'reschedule', scheduledFor: startOfUtcDayIso(), timeTbd: true },
  });
  assert.equal(res.status, 200, 'today at day resolution');
  assert.ok(res.body.ok);
  if (res.body.ok) assert.equal(res.body.data.timeTbd, true);
});

test('the list pin carries timeTbd so a stranger never sees the 8pm anchor as a showtime', async () => {
  await seedPublicList(host.uid, 'tbd-pin-list');
  const { night } = await createNight(hostTok, {
    listId: 'tbd-pin-list', listOwnerId: host.uid, timeTbd: true,
  });
  assert.ok(night);
  if (!night) return;

  const res = await callRoute<MovieNightPinView>(listMovieNightRoute, 'GET', {
    token: strangerTok,
    params: { ownerId: host.uid, listId: 'tbd-pin-list' },
    url: `http://test/api/v1/lists/${host.uid}/tbd-pin-list/movie-night`,
  });
  assert.ok(res.body.ok);
  if (res.body.ok) assert.equal(res.body.data?.timeTbd, true);
});

test('the invite push phrases a tbd night with a comma, never "at time tbd"', async () => {
  const { night } = await createNight(hostTok, { timeTbd: true });
  assert.ok(night);
  if (!night) return;

  const [notif] = await notificationsFor(invitee1.uid, 'movie_night_invite');
  assert.ok(notif, 'invitee notified');
  assert.equal(notif.nightTimeLabel, 'time tbd', 'the stored label never carries the anchor hour');
  assert.match(notif.previewText, /, time tbd$/, 'reads as prose');
  assert.doesNotMatch(notif.previewText, /at time tbd/, '"at time tbd" reads like a bug');
});

// ─── getUpcomingMovieNights ──────────────────────────────────────────────────

test('upcoming: returns the night for an invitee, not for a stranger', async () => {
  const { night } = await createNight(hostTok);
  assert.ok(night);
  if (!night) return;

  const inviteeRes = await callRoute<MovieNightView[]>(upcomingRoute, 'GET', { token: invitee1Tok });
  assert.equal(inviteeRes.status, 200);
  assert.ok(inviteeRes.body.ok);
  if (inviteeRes.body.ok) {
    assert.ok(inviteeRes.body.data.some((n) => n.id === night.id), 'invitee sees the night in upcoming');
  }

  const hostRes = await callRoute<MovieNightView[]>(upcomingRoute, 'GET', { token: hostTok });
  assert.ok(hostRes.body.ok);
  if (hostRes.body.ok) {
    assert.ok(hostRes.body.data.some((n) => n.id === night.id), 'host also sees their own night');
  }

  const strangerRes = await callRoute<MovieNightView[]>(upcomingRoute, 'GET', { token: strangerTok });
  assert.ok(strangerRes.body.ok);
  if (strangerRes.body.ok) {
    assert.ok(!strangerRes.body.data.some((n) => n.id === night.id), 'a stranger never sees it');
  }
});
