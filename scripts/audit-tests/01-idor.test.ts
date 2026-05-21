/**
 * Phase 1 pilot exploit test — IDOR via client-supplied userId.
 *
 * Vulnerability (pre-fix): `updateBio(userId, bio)` wrote to
 * users/{userId} where userId was a client argument. Any caller could rewrite
 * ANY user's bio by passing the victim's uid.
 *
 * Fix (AUDIT.md Phase 1): signature is now `updateBio(idToken, bio)`. The
 * server verifies the token and writes to the *verified* uid. There is no
 * userId parameter left to forge — the attack is structurally impossible.
 *
 * These tests assert the post-fix guarantees. They are the regression net:
 * if anyone reintroduces a trusted-userId parameter, the "cannot touch another
 * user" test fails.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv,
  createTestUser,
  callActionAs,
  callActionWithRawToken,
  adminDb,
  clearFirestore,
  clearAuth,
  type TestUser,
} from './harness.ts';

// actions.ts is imported in before() (not top-level) so it loads only after
// setup.ts has mocked next/cache, and to avoid CJS top-level-await.
let updateBio: (idToken: unknown, bio: string) => Promise<any>;

let alice: TestUser;
let bob: TestUser;

before(async () => {
  setupTestEnv();
  ({ updateBio } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  // Seed minimal profile docs (updateBio uses .update(), needs existing docs).
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
  const res = await callActionAs(alice, updateBio, 'alice new bio');
  assert.equal((res as any).success, true);

  const doc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(doc.data()?.bio, 'alice new bio');
});

test('attack is structurally impossible: alice cannot touch bob (no userId param exists)', async () => {
  // The strongest proof: even acting fully as alice, there is no argument by
  // which alice can target bob. bob's bio must remain untouched no matter what.
  await callActionAs(alice, updateBio, 'pwned by alice');

  const bobDoc = await adminDb().collection('users').doc(bob.uid).get();
  assert.equal(bobDoc.data()?.bio, 'bob original', "bob's bio was NOT modified");

  const aliceDoc = await adminDb().collection('users').doc(alice.uid).get();
  assert.equal(aliceDoc.data()?.bio, 'pwned by alice', 'only alice was affected');
});

test('rejects a forged/garbage token', async () => {
  const res = await callActionWithRawToken('not-a-real-token', updateBio, 'x');
  assert.deepEqual(res, { error: 'Unauthorized' });

  const bobDoc = await adminDb().collection('users').doc(bob.uid).get();
  assert.equal(bobDoc.data()?.bio, 'bob original');
});

test('rejects a missing/empty token', async () => {
  for (const bad of ['', undefined, null]) {
    const res = await callActionWithRawToken(bad, updateBio, 'x');
    assert.deepEqual(res, { error: 'Unauthorized' }, `rejected: ${String(bad)}`);
  }
});

test("rejects another project's / expired-shaped token (well-formed JWT, bad signature)", async () => {
  // header.payload.sig that is syntactically a JWT but not emulator-signed.
  const fakeJwt =
    'eyJhbGciOiJSUzI1NiJ9.eyJ1c2VyX2lkIjoiYXR0YWNrZXIifQ.bm90YXJlYWxzaWc';
  const res = await callActionWithRawToken(fakeJwt, updateBio, 'x');
  assert.deepEqual(res, { error: 'Unauthorized' });
});
