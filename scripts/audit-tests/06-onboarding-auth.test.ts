/**
 * Phase 1 — onboarding creators regression test.
 *
 * createUserProfile / ensureUserProfile / createUserProfileWithUsername run
 * right after Firebase signup. Pre-fix they trusted a client `userId`, so an
 * attacker could create/overwrite the profile doc of ANY uid. Post-fix the
 * profile is created for the verified token's uid only.
 *
 * Also a regression guard: ensureUserProfile runs on EVERY app load — it must
 * still create the profile + default list for a brand-new authed user.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let ensureUserProfile: (idToken: unknown, email: string, displayName: string | null) => Promise<any>;
let createUserProfile: (idToken: unknown, email: string, displayName: string | null) => Promise<any>;
let createUserProfileWithUsername: (idToken: unknown, email: string, username: string, displayName: string | null) => Promise<any>;

let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ ensureUserProfile, createUserProfile, createUserProfileWithUsername } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice'); // auth user exists, NO profile doc yet
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('ensureUserProfile: valid token creates profile + default list for the token uid (regression)', async () => {
  const res = await callActionAs(alice, ensureUserProfile, 'alice@example.com', 'Alice');
  assert.ok(!('error' in res), `expected success, got ${JSON.stringify(res)}`);
  assert.ok(res.defaultListId, 'returns a defaultListId');

  const profile = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(profile.exists, true, 'profile doc created');
  assert.equal(profile.data()?.uid, alice.uid, 'profile keyed to verified uid');

  const list = await adminDb()
    .collection('users').doc(alice.uid).collection('lists').doc(res.defaultListId).get();
  assert.equal(list.data()?.isDefault, true, 'default list created');
});

test('ensureUserProfile: forged/missing token rejected, no doc created', async () => {
  const forged = await callActionWithRawToken('forged', ensureUserProfile, 'x@x.com', 'X');
  assert.deepEqual(forged, { error: 'Unauthorized' });
  const missing = await callActionWithRawToken(undefined, ensureUserProfile, 'x@x.com', 'X');
  assert.deepEqual(missing, { error: 'Unauthorized' });

  const profile = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(profile.exists, false, 'no profile written for anyone');
});

test('createUserProfile: forged token cannot create a profile for another uid', async () => {
  const res = await callActionWithRawToken('forged', createUserProfile, 'v@x.com', 'Victim');
  assert.deepEqual(res, { error: 'Unauthorized' });
  assert.equal((await adminDb().collection('users').doc(alice.uid).get()).exists, false);
});

test('createUserProfileWithUsername: profile keyed to verified uid; forged rejected', async () => {
  const ok = await callActionAs(alice, createUserProfileWithUsername, 'alice@x.com', 'alice_handle', 'Alice');
  assert.ok(!('error' in ok), `expected success, got ${JSON.stringify(ok)}`);
  const doc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(doc.data()?.usernameLower, 'alice_handle', 'username set on verified uid');

  const bad = await callActionWithRawToken('', createUserProfileWithUsername, 'b@x.com', 'bad_handle', 'B');
  assert.deepEqual(bad, { error: 'Unauthorized' });
});
