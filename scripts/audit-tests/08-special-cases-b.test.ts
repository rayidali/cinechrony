/**
 * Phase 1 — special-case batch B regression (1.8–1.14).
 *
 *  1.8  backfillMovieUserData — sentinel "run-backfill-now" no longer accepted
 *  1.9  email split           — email NOT on public /users, lives in /users_private
 *  1.10 updateUsername        — writes usernameLower + reservation; dup rejected
 *  1.12 revokeInvite          — owner OR inviter; others blocked; forged blocked
 *  1.11 acceptInvite          — forged blocked; revoked invite cannot be accepted
 *  1.13 getListPreview        — private list not previewable by outsiders
 *  1.14 getListPendingInvites — collaborator gets NO inviteCode; outsider blocked
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let A: typeof import('@/app/actions');
let owner: TestUser, attacker: TestUser, collab: TestUser;

before(async () => {
  setupTestEnv();
  process.env.ADMIN_SECRET = 'test-admin-secret';
  A = await import('@/app/actions');
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
  collab = await createTestUser('collab');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('1.8 backfill: sentinel string and wrong secret are rejected; real secret works', async () => {
  assert.deepEqual(await A.backfillMovieUserData('run-backfill-now'), { error: 'Unauthorized' });
  assert.deepEqual(await A.backfillMovieUserData('nope'), { error: 'Unauthorized' });
  const ok = await A.backfillMovieUserData('test-admin-secret');
  assert.ok(!('error' in ok) || ok.error !== 'Unauthorized', 'real secret is accepted');
});

test('1.9 email split: public /users doc has NO email; /users_private does', async () => {
  const r = await callActionAs(owner, A.createUserProfileWithUsername, 'secret@x.com', 'ownerhandle', 'Owner');
  assert.ok(!('error' in r), JSON.stringify(r));

  const pub = await adminDb().collection('users').doc(owner.uid).get();
  assert.equal(pub.data()?.email, undefined, 'no email on public doc');
  assert.equal(pub.data()?.emailLower, undefined, 'no emailLower on public doc');

  const priv = await adminDb().collection('users_private').doc(owner.uid).get();
  assert.equal(priv.data()?.email, 'secret@x.com', 'email lives in users_private');
});

test('1.10/2.3a updateUsername: admin-only (users CANNOT change); admin path still transactional', async () => {
  await adminDb().collection('users').doc(owner.uid).set({ uid: owner.uid, username: 'old', usernameLower: 'old' });
  await adminDb().collection('users').doc(attacker.uid).set({ uid: attacker.uid, username: 'att', usernameLower: 'att' });

  // 2.3a: a normal user (token) can NOT change a username — it is immutable.
  // (Signature is now (adminSecret, userId, newUsername); a user token in the
  // adminSecret slot must be rejected.)
  const asUser = await callActionAs(owner, A.updateUsername, owner.uid, 'NewName');
  assert.deepEqual(asUser, { error: 'Unauthorized' }, 'users cannot change usernames');
  assert.equal((await adminDb().collection('users').doc(owner.uid).get()).data()?.username, 'old', 'unchanged by user');

  // Admin escape hatch (correct secret) still works — and still transactional:
  // writes username, usernameLower AND the reservation doc (the 1.10 fix).
  const ok = await A.updateUsername('test-admin-secret', owner.uid, 'NewName');
  assert.ok(!('error' in ok), JSON.stringify(ok));
  const doc = await adminDb().collection('users').doc(owner.uid).get();
  assert.equal(doc.data()?.username, 'newname');
  assert.equal(doc.data()?.usernameLower, 'newname', 'usernameLower written (the 1.10 fix, preserved)');
  assert.equal((await adminDb().collection('usernames').doc('newname').get()).data()?.uid, owner.uid, 'reservation doc created');

  // Uniqueness still enforced even via the admin path.
  const dup = await A.updateUsername('test-admin-secret', attacker.uid, 'newname');
  assert.deepEqual(dup, { error: 'Username is already taken.' });

  // Wrong secret rejected.
  assert.deepEqual(await A.updateUsername('wrong-secret', owner.uid, 'whatever'), { error: 'Unauthorized' });
});

test('1.12 revokeInvite: owner OR inviter can revoke; unrelated user + forged cannot', async () => {
  const mk = async (inviterId: string) => {
    const ref = adminDb().collection('invites').doc();
    await ref.set({ listId: 'L1', listOwnerId: owner.uid, inviterId, status: 'pending' });
    return ref.id;
  };

  // Unrelated attacker blocked.
  const i1 = await mk(collab.uid);
  const bad = await callActionAs(attacker, A.revokeInvite, i1);
  assert.ok('error' in bad && bad.error.includes('owner or the inviter'));

  // Owner can revoke a collaborator-created invite.
  const ok1 = await callActionAs(owner, A.revokeInvite, i1);
  assert.equal((ok1 as any).success, true);

  // Inviter can revoke their own.
  const i2 = await mk(collab.uid);
  const ok2 = await callActionAs(collab, A.revokeInvite, i2);
  assert.equal((ok2 as any).success, true);

  assert.deepEqual(await callActionWithRawToken('', A.revokeInvite, i1), { error: 'Unauthorized' });
});

test('1.11 acceptInvite: forged blocked; a revoked invite cannot be accepted', async () => {
  assert.deepEqual(await callActionWithRawToken('forged', A.acceptInvite, 'x'), { error: 'Unauthorized' });

  const ref = adminDb().collection('invites').doc();
  await ref.set({ listId: 'L1', listOwnerId: owner.uid, inviterId: owner.uid, status: 'revoked', inviteeId: collab.uid });
  const res = await callActionAs(collab, A.acceptInvite, ref.id);
  assert.ok('error' in res, 'revoked invite rejected');
});

test('1.13 getListPreview: private list hidden from outsiders, visible to owner', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('P')
    .set({ id: 'P', name: 'Private', ownerId: owner.uid, isPublic: false, collaboratorIds: [] });
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('P')
    .collection('movies').doc('m').set({ posterUrl: 'p.jpg', createdAt: new Date() });

  // No token / outsider token → empty (no leak).
  const noTok = await A.getListPreview(owner.uid, 'P');
  assert.deepEqual(noTok.previewPosters, [], 'no preview without auth');
  const outsider = await A.getListPreview(owner.uid, 'P', await attacker.getIdToken());
  assert.deepEqual(outsider.previewPosters, [], 'no preview for non-member');

  // Owner sees it.
  const ownerView = await A.getListPreview(owner.uid, 'P', await owner.getIdToken());
  assert.equal(ownerView.movieCount, 1, 'owner sees the private preview');
});

test('1.14 getListPendingInvites: collaborator gets NO inviteCode; outsider blocked', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [collab.uid] });
  await adminDb().collection('invites').doc('inv1').set({
    listId: 'L1', listOwnerId: owner.uid, inviterId: owner.uid, status: 'pending',
    inviteCode: 'SECRETCODE', listName: 'L',
  });

  const asCollab = await callActionAs(collab, A.getListPendingInvites, owner.uid, 'L1');
  assert.ok('invites' in asCollab && asCollab.invites.length === 1);
  assert.equal(asCollab.invites[0].inviteCode, undefined, 'collaborator does NOT get the join code');

  const asOwner = await callActionAs(owner, A.getListPendingInvites, owner.uid, 'L1');
  assert.equal((asOwner as any).invites[0].inviteCode, 'SECRETCODE', 'owner gets the code');

  const asOutsider = await callActionAs(attacker, A.getListPendingInvites, owner.uid, 'L1');
  assert.ok('error' in asOutsider, 'non-member blocked');

  assert.deepEqual(
    await callActionWithRawToken('forged', A.getListPendingInvites, owner.uid, 'L1'),
    { error: 'Unauthorized' }
  );
});
