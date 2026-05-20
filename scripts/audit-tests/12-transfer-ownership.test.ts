/**
 * Phase 2.1 — transferOwnership: integrity under batching, invites,
 * idempotency.
 *
 * Pre-fix bug class:
 *  - Single-batch copy then single-batch delete → broke past 500 movies.
 *  - Non-atomic phases → partial failure duplicated or orphaned movies.
 *  - `invites.listOwnerId` was NOT updated → collaborators stranded.
 *
 * Post-fix: atomic pre-flight tx; batched idempotent copy; new list doc;
 * invites re-pointed; batched delete of old movies; final delete of old
 * list doc as the canonical transition. This test exercises every clause.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let transferOwnership: (idToken: unknown, listId: string, newOwnerId: string) => Promise<any>;
let oldOwner: TestUser, newOwner: TestUser, third: TestUser, stranger: TestUser;

before(async () => {
  setupTestEnv();
  ({ transferOwnership } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  oldOwner = await createTestUser('oldowner');
  newOwner = await createTestUser('newowner');
  third    = await createTestUser('third');
  stranger = await createTestUser('stranger');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function seedList(opts: { movies?: number; collaborators?: string[] } = {}) {
  const collaborators = opts.collaborators ?? [newOwner.uid, third.uid];
  await adminDb()
    .collection('users').doc(oldOwner.uid)
    .collection('lists').doc('L')
    .set({ id: 'L', name: 'L', ownerId: oldOwner.uid, collaboratorIds: collaborators });

  // Seed N movies
  const n = opts.movies ?? 3;
  for (let i = 0; i < n; i++) {
    await adminDb()
      .collection('users').doc(oldOwner.uid)
      .collection('lists').doc('L').collection('movies').doc(`m${i}`)
      .set({ id: `m${i}`, title: `Movie ${i}` });
  }
}

async function seedInvite(inviterId: string, listOwnerId: string) {
  const ref = adminDb().collection('invites').doc();
  await ref.set({
    listId: 'L', listOwnerId, inviterId, status: 'pending',
  });
  return ref.id;
}

test('happy path: list + movies move to new owner; collaborator set swaps; invites re-point', async () => {
  await seedList({ movies: 3 });
  const i1 = await seedInvite(oldOwner.uid, oldOwner.uid);
  const i2 = await seedInvite(third.uid, oldOwner.uid);     // another inviter on this list
  const i3 = await seedInvite(stranger.uid, stranger.uid);  // unrelated invite (control)

  const res = await callActionAs(oldOwner, transferOwnership, 'L', newOwner.uid);
  assert.ok(!('error' in res), JSON.stringify(res));

  // Old path: list doc gone, no movies left in subcollection.
  const oldList = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').get();
  assert.equal(oldList.exists, false, 'old list doc deleted');
  const oldMovies = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').get();
  assert.equal(oldMovies.size, 0, 'old movies gone');

  // New path: list with correct owner + swapped collaborators (newOwner removed, oldOwner added).
  const newList = (await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').get()).data();
  assert.equal(newList?.ownerId, newOwner.uid, 'ownerId updated');
  assert.deepEqual(
    [...(newList?.collaboratorIds || [])].sort(),
    [third.uid, oldOwner.uid].sort(),
    'collaborator set swapped (newOwner out, oldOwner in, third kept)'
  );
  const newMovies = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').collection('movies').get();
  assert.equal(newMovies.size, 3, 'all 3 movies copied');

  // Invites: those pointing at oldOwner are now repointed; unrelated control untouched.
  const i1Doc = (await adminDb().collection('invites').doc(i1).get()).data();
  const i2Doc = (await adminDb().collection('invites').doc(i2).get()).data();
  const i3Doc = (await adminDb().collection('invites').doc(i3).get()).data();
  assert.equal(i1Doc?.listOwnerId, newOwner.uid, 'invite from oldOwner now points to new');
  assert.equal(i2Doc?.listOwnerId, newOwner.uid, 'invite from third (for this list) re-pointed');
  assert.equal(i3Doc?.listOwnerId, stranger.uid, 'unrelated invite untouched');
});

test('non-owner cannot affect the real owner\'s list (path-isolated → "not found", no leak)', async () => {
  await seedList();
  // A stranger calling transferOwnership operates on THEIR OWN path
  // (users/{stranger.uid}/lists/L) — which doesn't exist. They get a clean
  // "not found", AND critically can't even tell whether the real list exists
  // elsewhere. The real owner's list is untouched.
  const res = await callActionAs(stranger, transferOwnership, 'L', newOwner.uid);
  assert.deepEqual(res, { error: 'List not found.' });

  // Real security assertion: the actual list at the owner's path is intact.
  const oldList = (await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').get()).data();
  assert.equal(oldList?.ownerId, oldOwner.uid, "real owner's list is untouched by the attacker");
});

test('rejects when proposed new owner is not currently a collaborator', async () => {
  await seedList({ collaborators: [third.uid] }); // newOwner is NOT a collaborator
  const res = await callActionAs(oldOwner, transferOwnership, 'L', newOwner.uid);
  assert.deepEqual(res, { error: 'New owner must be an existing collaborator.' });
});

test('handles >batch-size movies correctly (multi-batch copy + delete)', async () => {
  // 600 movies exceeds the 450 BATCH_SIZE → forces ≥2 commits per phase.
  await seedList({ movies: 0 });
  const seedBatchA = adminDb().batch();
  const seedBatchB = adminDb().batch();
  for (let i = 0; i < 450; i++) {
    seedBatchA.set(
      adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').doc(`m${i}`),
      { id: `m${i}`, title: `Movie ${i}` }
    );
  }
  for (let i = 450; i < 600; i++) {
    seedBatchB.set(
      adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').doc(`m${i}`),
      { id: `m${i}`, title: `Movie ${i}` }
    );
  }
  await Promise.all([seedBatchA.commit(), seedBatchB.commit()]);

  const res = await callActionAs(oldOwner, transferOwnership, 'L', newOwner.uid);
  assert.ok(!('error' in res), JSON.stringify(res));

  const newMovies = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').collection('movies').count().get();
  assert.equal(newMovies.data().count, 600, 'all 600 movies copied across batches');
  const oldMovies = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').count().get();
  assert.equal(oldMovies.data().count, 0, 'all 600 old movies deleted across batches');
});

test('idempotency: double-transfer returns "list not found" gracefully (no corruption)', async () => {
  await seedList({ movies: 2 });
  const ok = await callActionAs(oldOwner, transferOwnership, 'L', newOwner.uid);
  assert.ok(!('error' in ok));

  // Second invocation — source already gone.
  const again = await callActionAs(oldOwner, transferOwnership, 'L', newOwner.uid);
  assert.deepEqual(again, { error: 'List not found.' });

  // State is still the expected post-transfer state.
  const newList = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').get();
  assert.equal(newList.data()?.ownerId, newOwner.uid);
});
