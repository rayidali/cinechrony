/**
 * Phase 1 — Lists domain regression test. Migrated to Phase A's HTTP surface.
 *
 * Pre-fix bug class (tautological auth): renameList/deleteList/etc. checked
 * `if (userId !== listOwnerId)` where BOTH were client-supplied. An attacker
 * just passed userId === listOwnerId === victim and the check passed, then the
 * action wrote to the victim's list.
 *
 * Post-fix: there is no userId param. The owner check is `auth.uid (from the
 * verified token) !== listOwnerId` (where listOwnerId now comes from the URL
 * path). The attacker can't make auth.uid equal the victim without the
 * victim's token, so the tautology is gone.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createListPost } from '@/app/api/v1/lists/route';
import { PATCH as patchList } from '@/app/api/v1/lists/[ownerId]/[listId]/route';

let owner: TestUser;
let attacker: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
});

after(async () => {
  await clearFirestore();
  await clearAuth();
});

test('POST /lists: list is created under the TOKEN owner', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute<{ listId: string }>(createListPost, 'POST', {
    token,
    body: { name: 'My List', isPublic: true },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok !== true) return;
  const listId = res.body.data.listId;

  const doc = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get();
  assert.equal(doc.exists, true);
  assert.equal(doc.data()?.ownerId, owner.uid, 'ownerId is the verified caller');
});

test('POST /lists: forged token cannot create a list', async () => {
  const res = await callRoute(createListPost, 'POST', {
    token: 'forged',
    body: { name: 'X', isPublic: true },
  });
  assert.equal(res.status, 401);
});

test('PATCH /lists/[ownerId]/[listId]: tautological attack is impossible', async () => {
  // Seed a list genuinely owned by `owner`.
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'Original', ownerId: owner.uid, isPublic: true });

  // Attacker, with their OWN token, tries to rename owner's list. The route
  // verifies the Bearer token (→ auth.uid = attacker.uid) and rejects because
  // auth.uid !== params.ownerId. There is no userId argument to forge.
  const attackerToken = await attacker.getIdToken();
  const attack = await callRoute(patchList, 'PATCH', {
    token: attackerToken,
    params: { ownerId: owner.uid, listId: 'L1' },
    body: { name: 'HACKED' },
  });
  assert.equal(attack.status, 403, 'attacker blocked at the owner check');

  const after1 = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(after1.data()?.name, 'Original', 'list name unchanged by attacker');

  // The real owner can still rename their own list.
  const ownerToken = await owner.getIdToken();
  const ok = await callRoute(patchList, 'PATCH', {
    token: ownerToken,
    params: { ownerId: owner.uid, listId: 'L1' },
    body: { name: 'Renamed' },
  });
  assert.equal(ok.status, 200);
  const after2 = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(after2.data()?.name, 'Renamed');
});
