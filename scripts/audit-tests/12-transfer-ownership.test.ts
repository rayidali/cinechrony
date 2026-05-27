/**
 * Phase 2.1 — transferOwnership: integrity under batching, invites,
 * idempotency. Migrated to Phase A's HTTP surface (PR #3).
 *
 * Pre-fix bug class:
 *  - Single-batch copy then single-batch delete → broke past 500 movies.
 *  - Non-atomic phases → partial failure duplicated or orphaned movies.
 *  - `invites.listOwnerId` was NOT updated → collaborators stranded.
 *
 * Post-fix: atomic pre-flight tx; batched idempotent copy; new list doc;
 * invites re-pointed; batched delete of old movies; final delete of old
 * list doc as the canonical transition. Helper lives in
 * `@/lib/lists-server`; this test exercises every clause through the route.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as transferPost } from '@/app/api/v1/lists/[ownerId]/[listId]/transfer/route';

let oldOwner: TestUser, newOwner: TestUser, third: TestUser, stranger: TestUser;

before(() => {
  setupTestEnv();
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

async function callTransfer(user: TestUser, ownerIdInPath: string, newOwnerUid: string) {
  return callRoute(transferPost, 'POST', {
    token: await user.getIdToken(),
    params: { ownerId: ownerIdInPath, listId: 'L' },
    body: { newOwnerId: newOwnerUid },
  });
}

test('happy path: list + movies move to new owner; collaborator set swaps; invites re-point', async () => {
  await seedList({ movies: 3 });
  const i1 = await seedInvite(oldOwner.uid, oldOwner.uid);
  const i2 = await seedInvite(third.uid, oldOwner.uid);     // another inviter on this list
  const i3 = await seedInvite(stranger.uid, stranger.uid);  // unrelated invite (control)

  const res = await callTransfer(oldOwner, oldOwner.uid, newOwner.uid);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // Old path: list doc gone, no movies left.
  const oldList = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').get();
  assert.equal(oldList.exists, false, 'old list doc deleted');
  const oldMovies = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').get();
  assert.equal(oldMovies.size, 0, 'old movies gone');

  // New path: list with correct owner + swapped collaborators.
  const newList = (await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').get()).data();
  assert.equal(newList?.ownerId, newOwner.uid, 'ownerId updated');
  assert.deepEqual(
    [...(newList?.collaboratorIds || [])].sort(),
    [third.uid, oldOwner.uid].sort(),
    'collaborator set swapped (newOwner out, oldOwner in, third kept)',
  );
  const newMovies = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').collection('movies').get();
  assert.equal(newMovies.size, 3, 'all 3 movies copied');

  // Invites: those pointing at oldOwner now re-pointed; unrelated control untouched.
  const i1Doc = (await adminDb().collection('invites').doc(i1).get()).data();
  const i2Doc = (await adminDb().collection('invites').doc(i2).get()).data();
  const i3Doc = (await adminDb().collection('invites').doc(i3).get()).data();
  assert.equal(i1Doc?.listOwnerId, newOwner.uid, 'invite from oldOwner now points to new');
  assert.equal(i2Doc?.listOwnerId, newOwner.uid, 'invite from third (for this list) re-pointed');
  assert.equal(i3Doc?.listOwnerId, stranger.uid, 'unrelated invite untouched');
});

test('non-owner attempting via their own path: list not found, real list untouched', async () => {
  await seedList();
  // Stranger calls /lists/{stranger.uid}/L/transfer — URL ownerId matches
  // their verified uid, but `users/{stranger.uid}/lists/L` doesn't exist.
  // Pre-flight returns ListNotFoundError → 404.
  const res = await callTransfer(stranger, stranger.uid, newOwner.uid);
  assert.equal(res.status, 404);

  // Real owner's list intact.
  const oldList = (await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').get()).data();
  assert.equal(oldList?.ownerId, oldOwner.uid, "real owner's list is untouched by the attacker");
});

test('non-owner attempting via the real owner path: 403, no leak', async () => {
  await seedList();
  // Stranger forges the URL: /lists/{oldOwner.uid}/L/transfer. The route's
  // belt-and-suspenders check (params.ownerId !== auth.uid) fires → 403.
  // Even if a future bug removes that check, the staged helper's pre-flight
  // would still reject (stored ownerId !== auth.uid).
  const res = await callTransfer(stranger, oldOwner.uid, newOwner.uid);
  assert.equal(res.status, 403);

  const oldList = (await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').get()).data();
  assert.equal(oldList?.ownerId, oldOwner.uid, "real owner's list is untouched by the attacker");
});

test('rejects when proposed new owner is not currently a collaborator', async () => {
  await seedList({ collaborators: [third.uid] }); // newOwner is NOT a collaborator
  const res = await callTransfer(oldOwner, oldOwner.uid, newOwner.uid);
  assert.equal(res.status, 400);
  if (res.body.ok === false) {
    assert.match(res.body.error.message, /collaborator/i);
  }
});

test('handles >batch-size movies correctly (multi-batch copy + delete)', async () => {
  // 600 movies exceeds the 450 BATCH_LIMIT → forces ≥2 commits per phase.
  await seedList({ movies: 0 });
  const seedBatchA = adminDb().batch();
  const seedBatchB = adminDb().batch();
  for (let i = 0; i < 450; i++) {
    seedBatchA.set(
      adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').doc(`m${i}`),
      { id: `m${i}`, title: `Movie ${i}` },
    );
  }
  for (let i = 450; i < 600; i++) {
    seedBatchB.set(
      adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').doc(`m${i}`),
      { id: `m${i}`, title: `Movie ${i}` },
    );
  }
  await Promise.all([seedBatchA.commit(), seedBatchB.commit()]);

  const res = await callTransfer(oldOwner, oldOwner.uid, newOwner.uid);
  assert.equal(res.status, 200);

  const newMovies = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').collection('movies').count().get();
  assert.equal(newMovies.data().count, 600, 'all 600 movies copied across batches');
  const oldMovies = await adminDb().collection('users').doc(oldOwner.uid).collection('lists').doc('L').collection('movies').count().get();
  assert.equal(oldMovies.data().count, 0, 'all 600 old movies deleted across batches');
});

test('idempotency: double-transfer returns list-not-found (404) gracefully', async () => {
  await seedList({ movies: 2 });
  const ok = await callTransfer(oldOwner, oldOwner.uid, newOwner.uid);
  assert.equal(ok.status, 200);

  // Second invocation — source already gone. The route's belt-and-suspenders
  // check fires first because oldOwner is no longer the owner of the list at
  // their own path (it doesn't exist there anymore). Either way, 404 from
  // the helper.
  const again = await callTransfer(oldOwner, oldOwner.uid, newOwner.uid);
  assert.equal(again.status, 404);

  // State is still the expected post-transfer state.
  const newList = await adminDb().collection('users').doc(newOwner.uid).collection('lists').doc('L').get();
  assert.equal(newList.data()?.ownerId, newOwner.uid);
});

test('rejects unauth (no token)', async () => {
  await seedList();
  const res = await callRoute(transferPost, 'POST', {
    params: { ownerId: oldOwner.uid, listId: 'L' },
    body: { newOwnerId: newOwner.uid },
  });
  assert.equal(res.status, 401);
});

test('rejects forged token', async () => {
  await seedList();
  const res = await callRoute(transferPost, 'POST', {
    token: 'forged',
    params: { ownerId: oldOwner.uid, listId: 'L' },
    body: { newOwnerId: newOwner.uid },
  });
  assert.equal(res.status, 401);
});

test('rejects self-transfer (newOwnerId === caller)', async () => {
  await seedList();
  const res = await callTransfer(oldOwner, oldOwner.uid, oldOwner.uid);
  assert.equal(res.status, 400);
});
