/**
 * Phase 0 smoke test — proves the harness + emulator wiring works.
 *
 * No server actions are exercised here yet; that starts in Phase 1. This only
 * verifies the foundation every later test depends on:
 *   1. Auth emulator: can create a user and mint an ID token
 *   2. Admin Auth: can verify that emulator-issued token
 *   3. Admin Firestore: can write and read a doc
 *   4. clearFirestore / clearAuth reset the emulator between tests
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv,
  createTestUser,
  adminAuth,
  adminDb,
  clearFirestore,
  clearAuth,
} from './harness.ts';

before(() => {
  setupTestEnv();
});

after(async () => {
  await clearFirestore();
  await clearAuth();
});

test('auth emulator mints an ID token that admin can verify', async () => {
  const userA = await createTestUser('alice');
  assert.ok(userA.uid, 'created user has a uid');

  const token = await userA.getIdToken();
  assert.ok(token.length > 100, 'got a non-trivial ID token');

  const decoded = await adminAuth().verifyIdToken(token);
  assert.equal(decoded.uid, userA.uid, 'admin verifies the token to the same uid');
});

test('admin Firestore can write and read back a document', async () => {
  await clearFirestore();

  const ref = adminDb().collection('users').doc('smoke-user');
  await ref.set({ username: 'smoke', createdAt: new Date().toISOString() });

  const snap = await ref.get();
  assert.equal(snap.exists, true, 'doc exists after write');
  assert.equal(snap.data()?.username, 'smoke', 'doc round-trips correctly');
});

test('clearFirestore wipes data', async () => {
  const ref = adminDb().collection('users').doc('to-be-wiped');
  await ref.set({ x: 1 });
  assert.equal((await ref.get()).exists, true, 'doc present before clear');

  await clearFirestore();

  assert.equal((await ref.get()).exists, false, 'doc gone after clearFirestore');
});

test('two users get distinct uids and tokens', async () => {
  const a = await createTestUser('userA');
  const b = await createTestUser('userB');
  assert.notEqual(a.uid, b.uid, 'distinct uids');

  const [ta, tb] = await Promise.all([a.getIdToken(), b.getIdToken()]);
  const [da, db] = await Promise.all([
    adminAuth().verifyIdToken(ta),
    adminAuth().verifyIdToken(tb),
  ]);
  assert.equal(da.uid, a.uid);
  assert.equal(db.uid, b.uid);
});
