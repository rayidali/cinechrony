/**
 * Phase 1 — Lists domain regression test.
 *
 * Pre-fix bug class (tautological auth): renameList/deleteList/etc. checked
 * `if (userId !== listOwnerId)` where BOTH were client-supplied. An attacker
 * just passed userId === listOwnerId === victim and the check passed, then the
 * action wrote to the victim's list.
 *
 * Post-fix: there is no userId param. The owner check is `auth.uid (from the
 * verified token) !== listOwnerId`. The attacker cannot make auth.uid equal the
 * victim without the victim's token, so the tautology is gone.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let createList: (idToken: unknown, name: string, isPublic?: boolean) => Promise<any>;
let renameList: (idToken: unknown, listOwnerId: string, listId: string, newName: string) => Promise<any>;

let owner: TestUser;
let attacker: TestUser;

before(async () => {
  setupTestEnv();
  ({ createList, renameList } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
});

test('createList: list is created under the TOKEN owner', async () => {
  const res = await callActionAs(owner, createList, 'My List', true);
  assert.equal((res as any).success, true);
  const listId = (res as any).listId;

  const doc = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get();
  assert.equal(doc.exists, true);
  assert.equal(doc.data()?.ownerId, owner.uid, 'ownerId is the verified caller');
});

test('createList: forged token cannot create a list', async () => {
  const res = await callActionWithRawToken('forged', createList, 'X', true);
  assert.deepEqual(res, { error: 'Unauthorized' });
});

test('renameList: tautological attack is impossible (attacker cannot be the owner)', async () => {
  // Seed a list genuinely owned by `owner`.
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'Original', ownerId: owner.uid, isPublic: true });

  // Attacker, with their OWN token, tries to rename owner's list. Pre-fix they
  // would pass userId=owner,listOwnerId=owner and win. Now identity = token.
  const attack = await callActionAs(attacker, renameList, owner.uid, 'L1', 'HACKED');
  assert.deepEqual(attack, { error: 'Only the list owner can rename the list.' });

  const after1 = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(after1.data()?.name, 'Original', 'list name unchanged by attacker');

  // The real owner can still rename their own list.
  const ok = await callActionAs(owner, renameList, owner.uid, 'L1', 'Renamed');
  assert.equal((ok as any).success, true);
  const after2 = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(after2.data()?.name, 'Renamed');
});
