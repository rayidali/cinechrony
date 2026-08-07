/**
 * Phase D0 — `PUT /api/v1/me/timezone` + the `users_private` storage.
 *
 * This field exists for ONE downstream consumer: the D6 notification policy's
 * "nothing between 10pm and 9am". Two properties therefore matter more than
 * the happy path, and both are asserted below:
 *
 *   1. It must NEVER land on the public `users/{uid}` doc. That doc's rule is
 *      `allow read: if true`, and a UTC offset is a coarse longitude.
 *   2. An absent value must be readable as `null`, not as 0 (UTC). Every user
 *      who has not opened the app since D0 shipped is in that state, and a
 *      silent 0 would put a whole population into London's quiet hours.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { PUT as timezoneRoute } from '@/app/api/v1/me/timezone/route';
import { getUserTimezone, isValidTzOffset } from '@/lib/profiles-server';

let user: TestUser, tok: string;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  user = await createTestUser('tz');
  tok = await user.getIdToken();
  await adminDb().collection('users').doc(user.uid).set({ uid: user.uid, username: 'tzuser' });
});

const put = (body: unknown, token = tok) =>
  callRoute<{ success: boolean }>(timezoneRoute, 'PUT', {
    token, body, url: 'http://test/api/v1/me/timezone',
  });

test('a valid offset is stored and reads back', async () => {
  const res = await put({ tzOffsetMinutes: 330 }); // UTC+5:30
  assert.equal(res.status, 200);
  assert.equal(await getUserTimezone(user.uid), 330);
});

test('the offset NEVER lands on the public users/{uid} doc', async () => {
  await put({ tzOffsetMinutes: -420 });

  const pub = await adminDb().collection('users').doc(user.uid).get();
  assert.equal(
    pub.data()?.tzOffsetMinutes, undefined,
    'users/{uid} is world-readable (allow read: if true) and a UTC offset is a coarse longitude',
  );
  const priv = await adminDb().collection('users_private').doc(user.uid).get();
  assert.equal(priv.data()?.tzOffsetMinutes, -420, 'it lives on the client-denied doc instead');
});

test('never recorded reads as null, not 0', async () => {
  // 0 is a REAL offset (UTC), so a missing value must not be indistinguishable
  // from London. Every pre-D0 user is in this state.
  assert.equal(await getUserTimezone(user.uid), null);
});

test('rejects the shapes a caller actually gets wrong', async () => {
  for (const [label, value] of [
    ['un-negated getTimezoneOffset() beyond range', -1500],
    ['seconds instead of minutes', 19800 * 60],
    ['fractional', 90.5],
    ['string', '330'],
    ['null', null],
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['past UTC+14', 900],
    ['before UTC-12', -800],
  ] as const) {
    const res = await put({ tzOffsetMinutes: value });
    assert.equal(res.status, 400, `${label} → 400`);
    assert.equal(await getUserTimezone(user.uid), null, `${label} wrote nothing`);
  }
});

test('the real-world extremes are accepted', async () => {
  // Baker Island and the Line Islands are the true bounds; a validator that
  // only allowed ±12h would silently reject Kiritimati and Chatham.
  for (const offset of [-720, -570, 0, 345, 840]) {
    assert.ok(isValidTzOffset(offset), `${offset} is a real offset`);
    const res = await put({ tzOffsetMinutes: offset });
    assert.equal(res.status, 200, `${offset} accepted`);
    assert.equal(await getUserTimezone(user.uid), offset);
  }
});

test('re-sending overwrites rather than accumulating', async () => {
  await put({ tzOffsetMinutes: 60 });
  await put({ tzOffsetMinutes: -300 });
  assert.equal(await getUserTimezone(user.uid), -300, 'a flight replaces the offset');
});

test('unauthenticated is rejected', async () => {
  const res = await callRoute(timezoneRoute, 'PUT', {
    body: { tzOffsetMinutes: 0 }, url: 'http://test/api/v1/me/timezone',
  });
  assert.equal(res.status, 401);
});
