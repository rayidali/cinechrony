/**
 * Phase 1 — special-case CRITICALS regression test.
 *
 *  1.2 deleteUserAccount  — auth was a PUBLIC username → anyone deletes anyone
 *  1.3 transferOwnership  — NO permission check → anyone steals any list
 *  1.4 removeCollaborator — tautological check → anyone kicks anyone
 *  1.6 updateMovieNote    — note keyed by client uid → spoof/delete others' notes
 *
 * Each test proves the attack is now rejected and (where applicable) that the
 * legitimate owner still works.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { DELETE as deleteMe } from '@/app/api/v1/me/route';
import { POST as transferPost } from '@/app/api/v1/lists/[ownerId]/[listId]/transfer/route';
import { PATCH as patchMovie } from '@/app/api/v1/lists/[ownerId]/[listId]/movies/[movieId]/route';
import { DELETE as removeCollabDelete } from '@/app/api/v1/lists/[ownerId]/[listId]/collaborators/[uid]/route';

let owner: TestUser;
let attacker: TestUser;
let collab: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
  collab = await createTestUser('collab');
  await adminDb().collection('users').doc(owner.uid).set({ uid: owner.uid, username: 'ownername' });
  await adminDb().collection('users').doc(attacker.uid).set({ uid: attacker.uid, username: 'attackername' });
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('1.2 DELETE /api/v1/me: attacker cannot delete the victim via public username', async () => {
  // Pre-fix: deleteUserAccount(victimUid, "ownername") would succeed.
  // Now the uid comes from the token; attacker's token + victim's username
  // fails the confirmation (which checks the CALLER's own username).
  const attackerToken = await attacker.getIdToken();
  const res = await callRoute(deleteMe, 'DELETE', {
    token: attackerToken,
    body: { confirmUsername: 'ownername' },
  });
  assert.equal(res.status, 400, 'attacker blocked at confirmation gate');

  const victim = await adminDb().collection('users').doc(owner.uid).get();
  assert.equal(victim.exists, true, 'victim profile still intact');

  // Forged token entirely → 401.
  const forged = await callRoute(deleteMe, 'DELETE', {
    token: 'forged',
    body: { confirmUsername: 'attackername' },
  });
  assert.equal(forged.status, 401);
});

test('1.3 POST /lists/[ownerId]/[listId]/transfer: non-owner cannot steal a list', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [attacker.uid] });

  // Attacker is a collaborator and tries to transfer ownership to themselves
  // by sending the real owner's path. The route's belt-and-suspenders check
  // (params.ownerId !== auth.uid) → 403. Even if that check were dropped,
  // the staged helper's pre-flight transaction would re-read the list and
  // reject (data.ownerId !== caller).
  const attackerToken = await attacker.getIdToken();
  const res = await callRoute(transferPost, 'POST', {
    token: attackerToken,
    params: { ownerId: owner.uid, listId: 'L1' },
    body: { newOwnerId: attacker.uid },
  });
  assert.equal(res.status, 403, 'attacker cannot transfer a list they do not own');

  const stolen = await adminDb()
    .collection('users').doc(attacker.uid).collection('lists').doc('L1').get();
  assert.equal(stolen.exists, false, 'no list created under attacker');
  const orig = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(orig.data()?.ownerId, owner.uid, 'ownership unchanged');
});

test('1.4 DELETE /collaborators/[uid]: non-owner cannot kick collaborators', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [collab.uid] });

  const params = { ownerId: owner.uid, listId: 'L1', uid: collab.uid };

  // Attacker is NOT the owner. Should be 403 — and the owner's check is
  // against the STORED ownerId, not a client-supplied param.
  const attackerToken = await attacker.getIdToken();
  const attack = await callRoute(removeCollabDelete, 'DELETE', {
    token: attackerToken, params,
  });
  assert.equal(attack.status, 403);

  const list1 = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.deepEqual(list1.data()?.collaboratorIds, [collab.uid], 'collaborator still present');

  // Real owner can remove.
  const ownerToken = await owner.getIdToken();
  const ok = await callRoute(removeCollabDelete, 'DELETE', {
    token: ownerToken, params,
  });
  assert.equal(ok.status, 200);
  const list2 = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.deepEqual(list2.data()?.collaboratorIds, [], 'owner removed the collaborator');
});

test('1.6 PATCH /movies/[id] (note): a member cannot spoof/delete another member\'s note', async () => {
  // owner + collab both on the list; a movie carries owner's note.
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [collab.uid] });
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .collection('movies').doc('m1').set({
      id: 'm1', title: 'Film', notes: { [owner.uid]: 'owner note' },
      noteAuthors: { [owner.uid]: { username: 'ownername' } },
    });

  // collab acts; pre-fix they could pass userId=owner and overwrite owner's note.
  // Now the note key is the verified caller's uid — collab can only write
  // notes.{collab.uid}, never touch notes.{owner.uid}.
  const collabToken = await collab.getIdToken();
  const res = await callRoute(patchMovie, 'PATCH', {
    token: collabToken,
    params: { ownerId: owner.uid, listId: 'L1', movieId: 'm1' },
    body: { note: 'collab note' },
  });
  assert.equal(res.status, 200, 'collab can write their OWN note');

  const movie = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1')
    .collection('movies').doc('m1').get();
  const notes = movie.data()?.notes || {};
  assert.equal(notes[owner.uid], 'owner note', "owner's note is untouched");
  assert.equal(notes[collab.uid], 'collab note', 'collab wrote only their own note');
});
