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
import { Timestamp } from 'firebase-admin/firestore';
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
