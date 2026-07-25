/**
 * Movie Night — S2 ticker + guest participation (MOVIE-NIGHT-PLAN.md).
 *
 * Covers `tickMovieNights` (reminder + morning-after, transactional claims,
 * tz-aware fire times) and the public `shared/[code]` surface (public view,
 * guest RSVP, .ics):
 *   - reminder: claims exactly once under two concurrent ticks; 'morning'
 *     preset respects local 9am; skipped entirely once a night is cancelled
 *   - morning-after: fires only after local 10am the day after, exactly
 *     once, only to in/maybe invitees + the host regardless of their answer
 *   - getMovieNightByCode: public shape leaks no uid; a malformed (too
 *     short) code 404s before any query
 *   - guest rsvp: a new guestId counts toward the cap, the 21st distinct one
 *     is rejected, an EXISTING guestId can always update its own row; the
 *     host is notified on the first answer / a real change, never on an
 *     identical repeat; the guest name is sanitized (control chars
 *     stripped, over-length clamped not rejected)
 *   - .ics: CRLF line endings, RFC 5545 comma escaping, DTSTART matches
 *     `scheduledFor` in UTC
 *
 * NOTE: the Firestore emulator does not enforce composite indexes, so the
 * ticker's (status, reminderSentAt|morningAfterSentAt, scheduledFor) queries
 * run fine here even though `firestore.indexes.json` needs a deploy in prod.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createRoute } from '@/app/api/v1/movie-nights/route';
import { POST as rsvpRoute } from '@/app/api/v1/movie-nights/[id]/rsvp/route';
import { GET as sharedRoute } from '@/app/api/v1/movie-nights/shared/[code]/route';
import { POST as guestRsvpRoute } from '@/app/api/v1/movie-nights/shared/[code]/rsvp/route';
import { GET as icsRoute } from '@/app/api/v1/movie-nights/shared/[code]/calendar.ics/route';
import { tickMovieNights, MAX_GUEST_RSVPS, GUEST_NAME_MAX, FILM_TITLE_MAX } from '@/lib/movie-nights-server';
import type { MovieNightView, MovieNightPublicView } from '@/lib/movie-night-types';

let host: TestUser, invitee1: TestUser, invitee2: TestUser, invitee3: TestUser, invitee4: TestUser;
let hostTok: string, invitee1Tok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  host = await createTestUser('host');
  invitee1 = await createTestUser('invitee1');
  invitee2 = await createTestUser('invitee2');
  invitee3 = await createTestUser('invitee3');
  invitee4 = await createTestUser('invitee4');
  hostTok = await host.getIdToken();
  invitee1Tok = await invitee1.getIdToken();
  await Promise.all([host, invitee1, invitee2, invitee3, invitee4].map((u) =>
    adminDb().collection('users').doc(u.uid).set({ uid: u.uid, username: u.uid.slice(0, 8), usernameLower: u.uid.slice(0, 8) }),
  ));
  await Promise.all(
    [invitee1, invitee2, invitee3, invitee4].map((u) => follow(host.uid, u.uid)),
  );
});

// ─── Fixtures + helpers ────────────────────────────────────────────────────

const FILM = { tmdbId: 550, mediaType: 'movie' as const, title: 'Fight Club', year: '1999', posterUrl: null, runtime: 139 };

function futureIso(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

async function follow(followerUid: string, targetUid: string): Promise<void> {
  await adminDb().doc(`users/${followerUid}/following/${targetUid}`).set({
    followerId: followerUid, followingId: targetUid, createdAt: new Date(),
  });
  await adminDb().doc(`users/${targetUid}/followers/${followerUid}`).set({
    followerId: followerUid, followingId: targetUid, createdAt: new Date(),
  });
}

async function createNight(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ night: MovieNightView | undefined }> {
  const res = await callRoute<MovieNightView>(createRoute, 'POST', {
    token,
    body: { film: FILM, scheduledFor: futureIso(), inviteeUids: [invitee1.uid], ...overrides },
  });
  return { night: res.body.ok ? res.body.data : undefined };
}

async function notificationsFor(uid: string, type?: string) {
  const snap = await adminDb().collection('notifications').where('userId', '==', uid).get();
  const docs = snap.docs.map((d) => d.data());
  return type ? docs.filter((d) => d.type === type) : docs;
}

async function notificationsByType(type: string) {
  const snap = await adminDb().collection('notifications').where('type', '==', type).get();
  return snap.docs.map((d) => d.data());
}

/** `.ics` returns a raw (non-JSON) Response — `callRoute` JSON-parses the
 *  body and would throw, so invoke the handler directly here. */
async function callRawGet(
  handler: (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => Promise<Response>,
  url: string,
  code: string,
): Promise<Response> {
  const req = new NextRequest(url, { method: 'GET' });
  return handler(req, { params: Promise.resolve({ code }) });
}

// ─── tickMovieNights — reminders ────────────────────────────────────────────

test('reminder claim fires exactly once under two concurrent ticks', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [invitee1.uid], reminderPreset: 'showtime' });
  assert.ok(night);
  if (!night) return;

  // 'showtime' fires exactly at scheduledFor — both concurrent ticks see the
  // SAME unclaimed doc via their (non-transactional) select query; only one
  // of their per-doc transactions may win the claim.
  const now = new Date(night.scheduledFor);
  const [r1, r2] = await Promise.all([tickMovieNights(now), tickMovieNights(now)]);
  assert.equal(r1.remindersSent + r2.remindersSent, 1, 'exactly one tick claimed the send');

  // Two recipients (host + invitee1, neither answered 'out') — if both ticks
  // had won, this would be 4.
  const notifs = await notificationsByType('movie_night_reminder');
  assert.equal(notifs.length, 2, 'exactly one round of fan-out, never doubled');

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.ok(raw.data()?.reminderSentAt, 'reminderSentAt claimed');
});

test("morning preset does not fire before local 9am, fires after", async () => {
  const { night } = await createNight(hostTok, {
    inviteeUids: [invitee1.uid], reminderPreset: 'morning', tzOffsetMinutes: 0,
  });
  assert.ok(night);
  if (!night) return;

  // Pin scheduledFor to a known UTC clock time (tzOffsetMinutes: 0 → local
  // == UTC) so the 9am-local math is exact, days out so it's always "future"
  // relative to real wall-clock creation-time validation.
  const day = new Date(night.scheduledFor);
  day.setUTCHours(20, 0, 0, 0); // 8pm that day
  await adminDb().doc(`movie_nights/${night.id}`).update({ scheduledFor: Timestamp.fromDate(day) });

  const before9 = new Date(day); before9.setUTCHours(8, 59, 0, 0);
  const r0 = await tickMovieNights(before9);
  assert.equal(r0.remindersSent, 0, 'not yet 9am local — no send');

  const after9 = new Date(day); after9.setUTCHours(9, 1, 0, 0);
  const r1 = await tickMovieNights(after9);
  assert.equal(r1.remindersSent, 1, 'past 9am local — sends');

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.ok(raw.data()?.reminderSentAt);
});

test('reminder skipped entirely when the night is cancelled before the ticker fires', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [invitee1.uid], reminderPreset: 'showtime' });
  assert.ok(night);
  if (!night) return;

  await adminDb().doc(`movie_nights/${night.id}`).update({ status: 'cancelled' });

  const now = new Date(night.scheduledFor);
  const result = await tickMovieNights(now);
  assert.equal(result.remindersSent, 0);

  const notifs = (await notificationsByType('movie_night_reminder')).filter((n) => n.nightId === night.id);
  assert.equal(notifs.length, 0);

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  assert.equal(raw.data()?.reminderSentAt, null, 'the status filter kept it out of the query entirely');
});

// ─── tickMovieNights — morning-after ────────────────────────────────────────

test('morning-after fires only after local 10am next day, once, only to in/maybe + host', async () => {
  const { night } = await createNight(hostTok, {
    inviteeUids: [invitee1.uid, invitee2.uid, invitee3.uid, invitee4.uid],
  });
  assert.ok(night);
  if (!night) return;

  const day = new Date(night.scheduledFor);
  day.setUTCHours(20, 0, 0, 0);
  await adminDb().doc(`movie_nights/${night.id}`).update({
    scheduledFor: Timestamp.fromDate(day),
    tzOffsetMinutes: 0,
    [`rsvps.${invitee1.uid}`]: { answer: 'in', respondedAt: Timestamp.now() },
    [`rsvps.${invitee2.uid}`]: { answer: 'maybe', respondedAt: Timestamp.now() },
    [`rsvps.${invitee3.uid}`]: { answer: 'out', respondedAt: Timestamp.now() },
    // invitee4 left unanswered ('waiting') — must never be notified.
  });

  const before10 = new Date(day); before10.setUTCDate(day.getUTCDate() + 1); before10.setUTCHours(9, 59, 0, 0);
  const r0 = await tickMovieNights(before10);
  assert.equal(r0.morningAftersSent, 0, 'not yet 10am local the next day — no send');

  const after10 = new Date(day); after10.setUTCDate(day.getUTCDate() + 1); after10.setUTCHours(10, 1, 0, 0);
  const r1 = await tickMovieNights(after10);
  assert.equal(r1.morningAftersSent, 1, 'past 10am local the next day — sends');

  const notifs = (await notificationsByType('movie_night_morning_after')).filter((n) => n.nightId === night.id);
  const recipientUids = notifs.map((n) => n.userId as string).sort();
  assert.deepEqual(recipientUids, [host.uid, invitee1.uid, invitee2.uid].sort(), 'only in/maybe + host, exactly');
  assert.ok(!recipientUids.includes(invitee3.uid), 'out is excluded');
  assert.ok(!recipientUids.includes(invitee4.uid), 'unanswered (waiting) is excluded');

  // once — a later tick doesn't resend (the claim + the status==proposed
  // query filter both keep it from firing again).
  const r2 = await tickMovieNights(new Date(after10.getTime() + 3600_000));
  assert.equal(r2.morningAftersSent, 0);
  const notifs2 = (await notificationsByType('movie_night_morning_after')).filter((n) => n.nightId === night.id);
  assert.equal(notifs2.length, 3, 'no duplicate sends on a later tick');
});

// ─── getMovieNightByCode — the public share view ────────────────────────────

test('shared read: public shape leaks no uid field', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [invitee1.uid] });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;

  await callRoute(rsvpRoute, 'POST', {
    token: invitee1Tok, params: { id: night.id }, url: `http://test/api/v1/movie-nights/${night.id}/rsvp`,
    body: { answer: 'in' },
  });

  const res = await callRoute<MovieNightPublicView>(sharedRoute, 'GET', {
    params: { code: night.shareCode }, url: `http://test/api/v1/movie-nights/shared/${night.shareCode}`,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  if (!res.body.ok) return;

  const json = JSON.stringify(res.body.data);
  assert.ok(!json.includes(host.uid), 'host uid never leaked');
  assert.ok(!json.includes(invitee1.uid), 'invitee uid never leaked');
  assert.ok(!('shareCode' in (res.body.data as object)), 'the code itself is never echoed back');
  assert.equal(res.body.data.counts.going, 2, 'host + invitee1 both in');
  assert.equal(res.body.data.status, 'proposed');
});

test('shared read: a malformed short code 404s (rejected before any query)', async () => {
  const res = await callRoute(sharedRoute, 'GET', {
    params: { code: 'short' }, url: 'http://test/api/v1/movie-nights/shared/short',
  });
  assert.equal(res.status, 404);
});

// ─── guestRsvpMovieNight — the no-account guest ─────────────────────────────

test('guest rsvp: new guestIds cap at MAX_GUEST_RSVPS, an existing guestId always updates', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [] });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;
  const code = night.shareCode;

  for (let i = 0; i < MAX_GUEST_RSVPS; i++) {
    const res = await callRoute(guestRsvpRoute, 'POST', {
      params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
      body: { guestId: `guest-id-${String(i).padStart(3, '0')}xxxxx`, name: `guest ${i}`, answer: 'in' },
    });
    assert.equal(res.status, 200, `guest ${i} should be accepted`);
  }

  // The next DISTINCT guestId (the (MAX_GUEST_RSVPS + 1)th) is rejected.
  const overflow = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId: 'guest-id-overflowxxxxx', name: 'overflow guest', answer: 'in' },
  });
  assert.equal(overflow.status, 400);

  // An EXISTING guestId can still update its own row, even at capacity.
  const update = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId: 'guest-id-000xxxxx', name: 'guest 0 renamed', answer: 'maybe' },
  });
  assert.equal(update.status, 200);

  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  const guestRsvps = (raw.data()?.guestRsvps || {}) as Record<string, { answer: string; name: string }>;
  assert.equal(Object.keys(guestRsvps).length, MAX_GUEST_RSVPS, 'still exactly the cap, never more');
  assert.equal(guestRsvps['guest-id-000xxxxx'].answer, 'maybe');
});

test('guest rsvp: host notified on first answer + a real change, never on an identical repeat', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [] });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;
  const code = night.shareCode;
  const guestId = 'repeat-guest-000xxxxx';

  const first = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId, name: 'ren', answer: 'in' },
  });
  assert.equal(first.status, 200);

  let notifs = await notificationsFor(host.uid, 'movie_night_rsvp');
  assert.equal(notifs.length, 1, 'first answer notifies the host');
  assert.ok(String(notifs[0].previewText).includes('ren (from your link)'), 'guest-flavor copy');

  const repeat = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId, name: 'ren', answer: 'in' },
  });
  assert.equal(repeat.status, 200);
  notifs = await notificationsFor(host.uid, 'movie_night_rsvp');
  assert.equal(notifs.length, 1, 'an identical repeat does not notify again');

  const changed = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId, name: 'ren', answer: 'maybe' },
  });
  assert.equal(changed.status, 200);
  notifs = await notificationsFor(host.uid, 'movie_night_rsvp');
  assert.equal(notifs.length, 2, 'a genuine answer change notifies again');
});

test('guest name sanitization: control chars stripped, whitespace collapsed, over-length clamped', async () => {
  const { night } = await createNight(hostTok, { inviteeUids: [] });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;
  const code = night.shareCode;

  const dirty = 'ren   \trocha\n';
  const res = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId: 'sanitize-dirtyxxxxxxx', name: dirty, answer: 'in' },
  });
  assert.equal(res.status, 200);
  const raw = await adminDb().doc(`movie_nights/${night.id}`).get();
  const stored = (raw.data()?.guestRsvps || {})['sanitize-dirtyxxxxxxx']?.name as string;
  assert.equal(stored, 'ren rocha', 'control chars stripped and whitespace collapsed');

  const long = 'a'.repeat(GUEST_NAME_MAX + 1); // 31 chars when GUEST_NAME_MAX is 30
  const res2 = await callRoute(guestRsvpRoute, 'POST', {
    params: { code }, url: `http://test/api/v1/movie-nights/shared/${code}/rsvp`,
    body: { guestId: 'sanitize-longxxxxxxxx', name: long, answer: 'in' },
  });
  assert.equal(res2.status, 200, 'a too-long name is CLAMPED, not rejected');
  const raw2 = await adminDb().doc(`movie_nights/${night.id}`).get();
  const stored2 = (raw2.data()?.guestRsvps || {})['sanitize-longxxxxxxxx']?.name as string;
  assert.equal(stored2.length, GUEST_NAME_MAX, 'clamped to GUEST_NAME_MAX');
});

// ─── movieNightIcs ───────────────────────────────────────────────────────

test('ics: CRLF line endings, RFC 5545 comma escaping, DTSTART matches scheduledFor UTC', async () => {
  const { night } = await createNight(hostTok, {
    inviteeUids: [], film: { ...FILM, title: 'okja, maybe' },
  });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;
  const code = night.shareCode;

  const res = await callRawGet(icsRoute, `http://test/api/v1/movie-nights/shared/${code}/calendar.ics`, code);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename=/);

  const text = await res.text();
  assert.ok(text.includes('\r\n'), 'CRLF line endings');
  assert.ok(text.includes('SUMMARY:movie night: okja\\, maybe'), 'the comma in the title is escaped');

  const expected = new Date(night.scheduledFor);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dtstart =
    `${expected.getUTCFullYear()}${pad(expected.getUTCMonth() + 1)}${pad(expected.getUTCDate())}` +
    `T${pad(expected.getUTCHours())}${pad(expected.getUTCMinutes())}${pad(expected.getUTCSeconds())}Z`;
  assert.ok(text.includes(`DTSTART:${dtstart}`), 'DTSTART matches scheduledFor in UTC');
});

test('ics: a malformed short code 404s', async () => {
  const res = await callRawGet(icsRoute, 'http://test/api/v1/movie-nights/shared/short/calendar.ics', 'short');
  assert.equal(res.status, 404);
});

// T6 (F7) — a hostile \r-laced, over-length title is sanitized/capped on
// create, and the rendered .ics never contains a bare CR (every \r is part
// of a real CRLF the line-folding step introduces, never one smuggled in
// through a field value).
test('create sanitizes a \\r-laced 300-char title; calendar.ics has no bare CR', async () => {
  const dirtyTitle = `evil\r\nBEGIN:VEVENT\r${'x'.repeat(300)}`;
  const { night } = await createNight(hostTok, {
    inviteeUids: [], film: { ...FILM, title: dirtyTitle },
  });
  assert.ok(night?.shareCode);
  if (!night?.shareCode) return;

  assert.ok(night.film.title.length <= FILM_TITLE_MAX, `stored title capped at ${FILM_TITLE_MAX}`);
  assert.ok(!night.film.title.includes('\r'), 'stored title has no carriage returns');
  assert.ok(!night.film.title.includes('\n'), 'stored title has no newlines');

  const res = await callRawGet(icsRoute, `http://test/api/v1/movie-nights/shared/${night.shareCode}/calendar.ics`, night.shareCode);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!/\r(?!\n)/.test(text), 'every \\r in the .ics is immediately followed by \\n — no bare CR anywhere');
});
