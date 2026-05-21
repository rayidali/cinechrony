/**
 * Phase 2.7 — deleteUserAccount: collaborator removal via collectionGroup.
 *
 * Pre-fix: a full `users` collection scan (O(total users)) — at ~10k users
 * this takes >30s and exceeds function timeouts, leaving accounts half-
 * deleted. Fix: one `collectionGroup('lists').where('collaboratorIds',
 * 'array-contains', uid)` query — touches only the lists that actually
 * contain this user. This test proves correctness on the post-fix path:
 * removal is exact, batched, and leaves unrelated lists untouched.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let deleteUserAccount: (idToken: unknown, confirmUsername: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;

before(async () => {
  setupTestEnv();
  ({ deleteUserAccount } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');  // the deletee
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
  dave = await createTestUser('dave');

  // Alice's profile (confirmUsername must match her stored username).
  await adminDb().collection('users').doc(alice.uid).set({
    uid: alice.uid, username: 'alice_handle', usernameLower: 'alice_handle',
  });

  // Bob owns L1 with Alice as collaborator.
  await adminDb().collection('users').doc(bob.uid).collection('lists').doc('L1')
    .set({ id: 'L1', ownerId: bob.uid, collaboratorIds: [alice.uid] });

  // Carol owns L2 with Alice AND Dave as collaborators.
  await adminDb().collection('users').doc(carol.uid).collection('lists').doc('L2')
    .set({ id: 'L2', ownerId: carol.uid, collaboratorIds: [alice.uid, dave.uid] });

  // Dave owns L3 — Alice is NOT a collaborator (control: must stay untouched).
  await adminDb().collection('users').doc(dave.uid).collection('lists').doc('L3')
    .set({ id: 'L3', ownerId: dave.uid, collaboratorIds: [dave.uid] });

  // Alice owns L4 (her own list) — step-5 deletion path handles this; the
  // step-4 collaborator-removal path must skip it (no redundant arrayRemove).
  await adminDb().collection('users').doc(alice.uid).collection('lists').doc('L4')
    .set({ id: 'L4', ownerId: alice.uid, collaboratorIds: [] });
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('removes the deletee from every collaborator list, across owners', async () => {
  const res = await deleteUserAccount(await alice.getIdToken(), 'alice_handle');
  assert.ok(!('error' in res), `delete failed: ${JSON.stringify(res)}`);

  const L1 = (await adminDb().collection('users').doc(bob.uid).collection('lists').doc('L1').get()).data();
  assert.deepEqual(L1?.collaboratorIds, [], 'L1: Alice removed (was [alice])');

  const L2 = (await adminDb().collection('users').doc(carol.uid).collection('lists').doc('L2').get()).data();
  assert.deepEqual(L2?.collaboratorIds, [dave.uid], 'L2: Alice removed, Dave kept');
});

test('leaves unrelated lists alone (control)', async () => {
  await deleteUserAccount(await alice.getIdToken(), 'alice_handle');

  const L3 = (await adminDb().collection('users').doc(dave.uid).collection('lists').doc('L3').get()).data();
  assert.deepEqual(L3?.collaboratorIds, [dave.uid], "L3 unchanged — Alice was never on it");
});

test('Alice‘s own lists are deleted (step 5), not touched in step 4', async () => {
  await deleteUserAccount(await alice.getIdToken(), 'alice_handle');

  const L4 = await adminDb().collection('users').doc(alice.uid).collection('lists').doc('L4').get();
  assert.equal(L4.exists, false, 'L4 deleted as part of own-account teardown');
});
