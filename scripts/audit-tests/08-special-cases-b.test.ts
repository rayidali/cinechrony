/**
 * Phase 1 — special-case batch B regression (1.8–1.14).
 *
 *  1.8  backfill auth gate — migrated to 41-admin-endpoints.test.ts (PR #16)
 *  1.9  email split — email NOT on public /users, lives in /users_private
 *  1.10 updateUsername admin path — retired in PR #18: the action had no
 *       remaining caller (no UI, no route) and was dead code. Username
 *       immutability for users is enforced by the lack of any update path;
 *       admin-side changes (trademark/abuse) happen via Firestore directly.
 *  1.11 acceptInvite — forged blocked; revoked invite cannot be accepted
 *  1.12 revokeInvite — owner OR inviter; others blocked; forged blocked
 *  1.13 getListPreview — private list not previewable by outsiders
 *  1.14 getListPendingInvites — collaborator gets NO inviteCode; outsider blocked
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as profilePost } from '@/app/api/v1/me/profile/route';
import { POST as acceptPost } from '@/app/api/v1/invites/accept/route';
import { DELETE as revokeDelete } from '@/app/api/v1/invites/[inviteId]/route';
import { GET as listInvitesGet } from '@/app/api/v1/lists/[ownerId]/[listId]/invites/route';
import { GET as listPreviewGet } from '@/app/api/v1/lists/[ownerId]/[listId]/preview/route';

let owner: TestUser, attacker: TestUser, collab: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
  collab = await createTestUser('collab');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('1.9 email split: public /users doc has NO email; /users_private does', async () => {
  const ownerToken = await owner.getIdToken();
  const r = await callRoute(profilePost, 'POST', {
    token: ownerToken,
    body: { email: 'secret@x.com', username: 'ownerhandle', displayName: 'Owner' },
  });
  assert.equal(r.status, 200);

  const pub = await adminDb().collection('users').doc(owner.uid).get();
  assert.equal(pub.data()?.email, undefined, 'no email on public doc');
  assert.equal(pub.data()?.emailLower, undefined, 'no emailLower on public doc');

  const priv = await adminDb().collection('users_private').doc(owner.uid).get();
  assert.equal(priv.data()?.email, 'secret@x.com', 'email lives in users_private');
});

test('1.12 DELETE /invites/[inviteId]: owner OR inviter can revoke; unrelated user + forged cannot', async () => {
  const mk = async (inviterId: string) => {
    const ref = adminDb().collection('invites').doc();
    await ref.set({ listId: 'L1', listOwnerId: owner.uid, inviterId, status: 'pending' });
    return ref.id;
  };

  const i1 = await mk(collab.uid);
  const attackerToken = await attacker.getIdToken();
  const bad = await callRoute(revokeDelete, 'DELETE', {
    token: attackerToken, params: { inviteId: i1 },
  });
  assert.equal(bad.status, 403);
  if (bad.body.ok === false) {
    assert.ok(bad.body.error.message.includes('owner or the inviter'));
  }

  const ownerToken = await owner.getIdToken();
  const ok1 = await callRoute(revokeDelete, 'DELETE', {
    token: ownerToken, params: { inviteId: i1 },
  });
  assert.equal(ok1.status, 200);

  const i2 = await mk(collab.uid);
  const collabToken = await collab.getIdToken();
  const ok2 = await callRoute(revokeDelete, 'DELETE', {
    token: collabToken, params: { inviteId: i2 },
  });
  assert.equal(ok2.status, 200);

  const forged = await callRoute(revokeDelete, 'DELETE', {
    token: 'forged', params: { inviteId: i1 },
  });
  assert.equal(forged.status, 401);
});

test('1.11 POST /invites/accept: forged blocked; a revoked invite cannot be accepted', async () => {
  const forged = await callRoute(acceptPost, 'POST', {
    token: 'forged',
    body: { inviteId: 'x' },
  });
  assert.equal(forged.status, 401);

  const ref = adminDb().collection('invites').doc();
  await ref.set({ listId: 'L1', listOwnerId: owner.uid, inviterId: owner.uid, status: 'revoked', inviteeId: collab.uid });
  const collabToken = await collab.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token: collabToken,
    body: { inviteId: ref.id },
  });
  assert.notEqual(res.status, 200, 'revoked invite rejected');
  assert.equal(res.status, 409);
});

test('1.13 getListPreview: private list hidden from outsiders, visible to owner', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('P')
    .set({ id: 'P', name: 'Private', ownerId: owner.uid, isPublic: false, collaboratorIds: [] });
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('P')
    .collection('movies').doc('m').set({ posterUrl: 'p.jpg', createdAt: new Date() });

  const params = { ownerId: owner.uid, listId: 'P' };

  // No token → empty (no leak).
  const noTok = await callRoute<{ previewPosters: string[]; movieCount: number }>(
    listPreviewGet, 'GET', { params },
  );
  if (noTok.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(noTok.body.data.previewPosters, [], 'no preview without auth');

  // Outsider token → empty.
  const attackerToken = await attacker.getIdToken();
  const outsider = await callRoute<{ previewPosters: string[]; movieCount: number }>(
    listPreviewGet, 'GET', { token: attackerToken, params },
  );
  if (outsider.body.ok !== true) return assert.fail('expected ok');
  assert.deepEqual(outsider.body.data.previewPosters, [], 'no preview for non-member');

  // Owner sees it.
  const ownerToken = await owner.getIdToken();
  const ownerView = await callRoute<{ previewPosters: string[]; movieCount: number }>(
    listPreviewGet, 'GET', { token: ownerToken, params },
  );
  if (ownerView.body.ok !== true) return assert.fail('expected ok');
  assert.equal(ownerView.body.data.movieCount, 1, 'owner sees the private preview');
});

test('1.14 GET /lists/[ownerId]/[listId]/invites: collaborator gets NO inviteCode; outsider blocked', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [collab.uid] });
  await adminDb().collection('invites').doc('inv1').set({
    listId: 'L1', listOwnerId: owner.uid, inviterId: owner.uid, status: 'pending',
    inviteCode: 'SECRETCODE', listName: 'L',
  });

  const params = { ownerId: owner.uid, listId: 'L1' };

  const collabToken = await collab.getIdToken();
  const asCollab = await callRoute<{ invites: Array<{ inviteCode?: string }> }>(
    listInvitesGet, 'GET', { token: collabToken, params },
  );
  assert.equal(asCollab.status, 200);
  if (asCollab.body.ok !== true) return assert.fail('expected ok');
  assert.equal(asCollab.body.data.invites.length, 1);
  assert.equal(asCollab.body.data.invites[0].inviteCode, undefined, 'collaborator does NOT get the join code');

  const ownerToken = await owner.getIdToken();
  const asOwner = await callRoute<{ invites: Array<{ inviteCode?: string }> }>(
    listInvitesGet, 'GET', { token: ownerToken, params },
  );
  assert.equal(asOwner.status, 200);
  if (asOwner.body.ok !== true) return assert.fail('expected ok');
  assert.equal(asOwner.body.data.invites[0].inviteCode, 'SECRETCODE', 'owner gets the code');

  const attackerToken = await attacker.getIdToken();
  const asOutsider = await callRoute(listInvitesGet, 'GET', { token: attackerToken, params });
  assert.equal(asOutsider.status, 403, 'non-member blocked');

  const forged = await callRoute(listInvitesGet, 'GET', { token: 'forged', params });
  assert.equal(forged.status, 401);
});
