/**
 * Phase 1 — onboarding creators regression test.
 *
 * Migrated to /api/v1 in Phase A.5 (PR #18). Routes:
 *   POST /api/v1/me/ensure   — ensureUserProfile (idempotent boot helper)
 *   POST /api/v1/me/profile  — createUserProfileWithUsername (onboarding pick-handle step)
 *
 * The legacy `createUserProfile` Server Action (token + email + displayName,
 * generating a username from the email) was dead code (no remaining callers
 * once onboarding moved fully to `createUserProfileWithUsername`) and is gone.
 *
 * Asserts: profile is keyed to the verified token UID; forged/missing
 * tokens are rejected; default list is created.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as ensurePost } from '@/app/api/v1/me/ensure/route';
import { POST as profilePost } from '@/app/api/v1/me/profile/route';

let alice: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('POST /me/ensure: valid token creates profile + default list for the token uid', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ defaultListId: string }>(ensurePost, 'POST', {
    token, body: { email: 'alice@example.com', displayName: 'Alice' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.ok(res.body.data.defaultListId);

  const profile = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(profile.exists, true);
  assert.equal(profile.data()?.uid, alice.uid);

  const list = await adminDb()
    .collection('users').doc(alice.uid).collection('lists').doc(res.body.data.defaultListId).get();
  assert.equal(list.data()?.isDefault, true);
});

test('POST /me/ensure: forged/missing token rejected, no doc created', async () => {
  const forged = await callRoute(ensurePost, 'POST', {
    token: 'forged', body: { email: 'x@x.com', displayName: 'X' },
  });
  assert.equal(forged.status, 401);

  const missing = await callRoute(ensurePost, 'POST', {
    body: { email: 'x@x.com', displayName: 'X' },
  });
  assert.equal(missing.status, 401);

  const profile = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(profile.exists, false);
});

test('POST /me/profile: profile keyed to verified uid; forged rejected', async () => {
  const token = await alice.getIdToken();
  const ok = await callRoute(profilePost, 'POST', {
    token,
    body: { email: 'alice@x.com', username: 'alice_handle', displayName: 'Alice' },
  });
  assert.equal(ok.status, 200);

  const doc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(doc.data()?.usernameLower, 'alice_handle');

  const bad = await callRoute(profilePost, 'POST', {
    body: { email: 'b@x.com', username: 'bad_handle', displayName: 'B' },
  });
  assert.equal(bad.status, 401);
});

test('POST /me/profile: rejects username already taken (409)', async () => {
  // Seed another user with the username.
  await adminDb().collection('users').doc('other').set({
    uid: 'other', username: 'taken_handle', usernameLower: 'taken_handle',
  });
  const token = await alice.getIdToken();
  const res = await callRoute(profilePost, 'POST', {
    token,
    body: { email: 'alice@x.com', username: 'taken_handle', displayName: 'Alice' },
  });
  assert.equal(res.status, 409);
});

test('POST /me/profile: rejects malformed username (400)', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(profilePost, 'POST', {
    token,
    body: { email: 'alice@x.com', username: 'AB', displayName: 'Alice' },
  });
  assert.equal(res.status, 400);
});
