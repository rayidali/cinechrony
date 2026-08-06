/**
 * Movie Night — the S2 reminder ticker (`tickMovieNights`).
 *
 * WHY THIS SUITE EXISTS. The ticker had NO test coverage of any kind, and on
 * 2026-08-06 that turned out to have cost real reminders. `.github/workflows/
 * movie-nights-tick.yml` asks for a tick every 10 minutes; GitHub delivered 177
 * of ~1790 over the preceding 12 days, with consecutive gaps of 49 / 92 / 217
 * minutes. The reminder claim is ONE-SHOT — miss the window and nothing ever
 * retries — so a night whose whole window fell inside one gap was lost:
 *
 *   zNyWnTuk  05.08  preset '2h'        135min window, 0 ticks landed in it
 *   nFZpy6d2  27.07  preset 'showtime'   15min window, 0 ticks landed in it
 *
 * Every test below is written against a TICK GAP, not against the cron string,
 * because the cron string was never the thing that decided delivery.
 *
 * The two halves are tested together on purpose: widening the window is only
 * safe because the copy stops claiming "starts soon" when it didn't. A future
 * edit that widens one without the other should fail here.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { tickMovieNights } from '@/lib/movie-nights-server';
import type { ReminderPreset } from '@/lib/movie-night-types';

let host: TestUser, invitee: TestUser;

/** A fixed, far-future showtime so no test depends on the wall clock — the
 *  harness class of bug this repo has hit nine times (see CLAUDE.md 2026-08-02:
 *  a gate that silently depended on the time of day). 20:00Z at tz 0 renders as
 *  '8:00 pm', which is also the tbd anchor, so a leaked anchor is detectable. */
const SHOWTIME = new Date('2030-06-14T20:00:00.000Z');
const T = SHOWTIME.getTime();
const MIN = 60_000;
const HOUR = 3600_000;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  host = await createTestUser('host');
  invitee = await createTestUser('invitee');
  await Promise.all([host, invitee].map((u) =>
    adminDb().collection('users').doc(u.uid).set({
      uid: u.uid, username: u.uid.slice(0, 8), usernameLower: u.uid.slice(0, 8),
    }),
  ));
});

async function seedNight(opts: { preset?: ReminderPreset; timeTbd?: boolean } = {}): Promise<string> {
  const ref = adminDb().collection('movie_nights').doc();
  await ref.set({
    hostUid: host.uid,
    listId: 'l1', listOwnerId: host.uid, listName: 'movie night list',
    film: { tmdbId: 1, mediaType: 'movie', title: 'solaris', year: 1972, posterUrl: null, runtime: null },
    scheduledFor: Timestamp.fromDate(SHOWTIME),
    previousScheduledFor: null,
    tzOffsetMinutes: 0,
    reminderPreset: opts.preset ?? '2h',
    ...(opts.timeTbd ? { timeTbd: true } : {}),
    status: 'proposed',
    inviteeUids: [host.uid, invitee.uid],
    invitees: {
      [host.uid]: { username: host.uid.slice(0, 8), displayName: null, photoURL: null },
      [invitee.uid]: { username: invitee.uid.slice(0, 8), displayName: null, photoURL: null },
    },
    rsvps: {}, guestRsvps: {},
    shareCode: 'x'.repeat(20), clientKey: null,
    reminderSentAt: null, morningAfterSentAt: null, completion: null,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  return ref.id;
}

async function reminders(): Promise<string[]> {
  const snap = await adminDb().collection('notifications')
    .where('type', '==', 'movie_night_reminder').get();
  return snap.docs.map((d) => String(d.data().previewText));
}

// ── the regression that shipped ──────────────────────────────────────────
//
// The old window was [showtime - 2h, showtime + 15min] — 135 minutes against a
// median 92-minute and worst-case 217-minute tick gap. Both instants below sit
// OUTSIDE it, so both of these tests fail on the pre-2026-08-06 code.

test('a tick 3.5h before showtime still delivers (old window started at -2h and would have dropped it)', async () => {
  const id = await seedNight({ preset: '2h' });
  await tickMovieNights(new Date(T - 3.5 * HOUR));

  const raw = await adminDb().doc(`movie_nights/${id}`).get();
  assert.ok(raw.data()?.reminderSentAt, 'reminder claimed');
  assert.equal((await reminders()).length, 2, 'one per invitee');
});

test('a tick 45min AFTER showtime still delivers (old grace was 15min and would have dropped it)', async () => {
  const id = await seedNight({ preset: '2h' });
  await tickMovieNights(new Date(T + 45 * MIN));

  const raw = await adminDb().doc(`movie_nights/${id}`).get();
  assert.ok(raw.data()?.reminderSentAt, 'reminder claimed');
  assert.equal((await reminders()).length, 2, 'one per invitee');
});

test('the query lookback is coupled to the grace — a night 80min past showtime is still REACHABLE', async () => {
  // Guards the exact latent bug this fix removed: the sweep selects on
  // `scheduledFor`, so a grace widened past the query's lookback buys nothing
  // and the constant lies about it. If REMINDER_WINDOW_BEFORE_MS is ever
  // decoupled from REMINDER_GRACE_MS again, this is what catches it.
  const id = await seedNight({ preset: '2h' });
  await tickMovieNights(new Date(T + 80 * MIN));
  assert.ok((await adminDb().doc(`movie_nights/${id}`).get()).data()?.reminderSentAt);
});

// ── the copy has to earn the wider window ────────────────────────────────

test('copy is honest at each end: ahead / soon / started', async () => {
  for (const [label, when, expect, forbid] of [
    ['ahead',   T - 3.5 * HOUR, 'tonight: solaris at',         'grab your snacks'],
    ['soon',    T - 1 * HOUR,   'grab your snacks',            'started at'],
    ['started', T + 45 * MIN,   'solaris started at',          'grab your snacks'],
  ] as const) {
    await clearFirestore();
    await Promise.all([host, invitee].map((u) =>
      adminDb().collection('users').doc(u.uid).set({ uid: u.uid, username: u.uid.slice(0, 8) }),
    ));
    await seedNight({ preset: '2h' });
    await tickMovieNights(new Date(when));

    const texts = await reminders();
    assert.equal(texts.length, 2, `${label}: sent`);
    assert.ok(texts[0].includes(expect), `${label}: preview says "${expect}" — got "${texts[0]}"`);
    assert.ok(!texts[0].includes(forbid), `${label}: preview must not say "${forbid}" — got "${texts[0]}"`);
  }
});

test('a late reminder never claims the film is about to start', async () => {
  await seedNight({ preset: 'showtime' });
  await tickMovieNights(new Date(T + 60 * MIN));

  const texts = await reminders();
  assert.equal(texts.length, 2);
  for (const t of texts) {
    assert.ok(!/starts?\s+soon/i.test(t), `no "starts soon" an hour in — got "${t}"`);
    assert.ok(!/grab your snacks/i.test(t), `no "grab your snacks" an hour in — got "${t}"`);
    assert.ok(t.includes('started at'), `says it already started — got "${t}"`);
  }
});

test('a tbd night carries no timing and never prints the 8pm anchor', async () => {
  // The whole tbd feature rests on the anchor never being rendered. A wider
  // window means more chances to render it, so it is asserted here too.
  await seedNight({ preset: '2h', timeTbd: true });
  await tickMovieNights(new Date(T - 3 * HOUR));

  const texts = await reminders();
  assert.equal(texts.length, 2, 'tbd nights still get a reminder');
  for (const t of texts) {
    assert.ok(t.includes('tbd'), `names the open question — got "${t}"`);
    assert.ok(!t.includes('8:00'), `the 8pm anchor never leaks — got "${t}"`);
    assert.ok(!/started at/.test(t), `a night with no showtime cannot have started — got "${t}"`);
  }
});

// ── still bounded, and still one-shot ────────────────────────────────────

test('widening the window did not make it always-on', async () => {
  for (const [label, when] of [
    ['5h early (before the lead)', T - 5 * HOUR],
    ['2h late (past the grace)',   T + 2 * HOUR],
  ] as const) {
    await clearFirestore();
    const id = await seedNight({ preset: '2h' });
    await tickMovieNights(new Date(when));
    const raw = await adminDb().doc(`movie_nights/${id}`).get();
    assert.equal(raw.data()?.reminderSentAt, null, `${label}: not sent`);
    assert.equal((await reminders()).length, 0, `${label}: no notification`);
  }
});

test('the early lead is NOT applied to a morning-anchored preset (it would only mean a 7am push)', async () => {
  // The lead exists to rescue a window too narrow to survive the tick gap.
  // 'morning' already runs 9am → showtime, so leading it buys nothing and
  // costs a 7am buzz. Caught by suite 54 when this fix first over-applied the
  // lead to every preset; asserted here too, next to the reasoning.
  const id = await seedNight({ preset: 'morning' });   // fires 09:00Z (tz 0)

  await tickMovieNights(new Date(T - 12.5 * HOUR));    // 07:30Z — inside a 2h lead
  assert.equal(
    (await adminDb().doc(`movie_nights/${id}`).get()).data()?.reminderSentAt, null,
    'no 7:30am push',
  );

  await tickMovieNights(new Date(T - 10.5 * HOUR));    // 09:30Z — after 9am
  assert.ok((await adminDb().doc(`movie_nights/${id}`).get()).data()?.reminderSentAt, 'fires after 9am');
});

test('two ticks inside the (now much wider) window still send exactly once', async () => {
  const id = await seedNight({ preset: '2h' });
  await tickMovieNights(new Date(T - 3 * HOUR));
  await tickMovieNights(new Date(T - 1 * HOUR));

  assert.equal((await reminders()).length, 2, 'two invitees, one reminder each, not four');
  assert.ok((await adminDb().doc(`movie_nights/${id}`).get()).data()?.reminderSentAt);
});
