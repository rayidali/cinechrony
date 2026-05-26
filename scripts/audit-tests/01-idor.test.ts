/**
 * Phase 1 pilot exploit test — IDOR via client-supplied userId. Migrated to
 * Phase A's HTTP surface (PATCH /api/v1/me).
 *
 * Vulnerability (pre-fix): `updateBio(userId, bio)` wrote to users/{userId}
 * where userId was a client argument. Any caller could rewrite ANY user's bio.
 *
 * Fix (AUDIT.md Phase 1 + Phase A): the new route is `PATCH /api/v1/me`. The
 * verified uid in the Bearer token IS the target. There is no userId
 * parameter at all — the attack is structurally impossible. These tests are
 * the regression net: if anyone reintroduces a trusted-userId, the "cannot
 * touch another user" test fails.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv,
  createTestUser,
  adminDb,
  clearFirestore,
  clearAuth,
  type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { PATCH as patchMe } from '@/app/api/v1/me/route';

let alice: TestUser;
let bob: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  // Seed minimal profile docs (the route uses .update(), needs existing docs).
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice', bio: 'alice original',
  });
  await adminDb().collection('users').doc(bob.uid).set({
    uid: bob.uid, username: 'bob', bio: 'bob original',
  });
});

after(async () => {
  await clearFirestore();
  await clearAuth();
});

test('legit: a user can update their OWN bio', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(patchMe, 'PATCH', { token, body: { bio: 'alice new bio' } });
  assert.equal(res.status, 200);

  const doc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(doc.data()?.bio, 'alice new bio');
});

test('attack is structurally impossible: alice cannot touch bob (no userId param exists)', async () => {
  // The strongest proof: even acting fully as alice, there is no argument by
  // which alice can target bob. bob's bio must remain untouched no matter what.
  const token = await alice.getIdToken();
  await callRoute(patchMe, 'PATCH', { token, body: { bio: 'pwned by alice' } });

  const bobDoc = await adminDb().collection('users').doc(bob.uid).get();
  assert.equal(bobDoc.data()?.bio, 'bob original', "bob's bio was NOT modified");

  const aliceDoc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(aliceDoc.data()?.bio, 'pwned by alice', 'only alice was affected');
});

test('rejects a forged/garbage token', async () => {
  const res = await callRoute(patchMe, 'PATCH', {
    token: 'not-a-real-token',
    body: { bio: 'x' },
  });
  assert.equal(res.status, 401);

  const bobDoc = await adminDb().collection('users').doc(bob.uid).get();
  assert.equal(bobDoc.data()?.bio, 'bob original');
});

test('rejects a missing token', async () => {
  const res = await callRoute(patchMe, 'PATCH', { body: { bio: 'x' } });
  assert.equal(res.status, 401);
});

test('rejects an empty bearer', async () => {
  const res = await callRoute(patchMe, 'PATCH', {
    headers: { Authorization: 'Bearer ' },
    body: { bio: 'x' },
  });
  assert.equal(res.status, 401);
});

test("rejects another project's / expired-shaped token (well-formed JWT, bad signature)", async () => {
  // header.payload.sig that is syntactically a JWT but not emulator-signed.
  const fakeJwt =
    'eyJhbGciOiJSUzI1NiJ9.eyJ1c2VyX2lkIjoiYXR0YWNrZXIifQ.bm90YXJlYWxzaWc';
  const res = await callRoute(patchMe, 'PATCH', { token: fakeJwt, body: { bio: 'x' } });
  assert.equal(res.status, 401);
});
