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
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let deleteUserAccount: (idToken: unknown, confirmUsername: string) => Promise<any>;
let transferOwnership: (idToken: unknown, listId: string, newOwnerId: string) => Promise<any>;
let removeCollaborator: (idToken: unknown, ownerId: string, listId: string, collaboratorId: string) => Promise<any>;
let updateMovieNote: (idToken: unknown, listOwnerId: string, listId: string, movieId: string, note: string) => Promise<any>;

let owner: TestUser;
let attacker: TestUser;
let collab: TestUser;

before(async () => {
  setupTestEnv();
  ({ deleteUserAccount, transferOwnership, removeCollaborator, updateMovieNote } = await import('@/app/actions'));
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

test('1.2 deleteUserAccount: attacker cannot delete the victim via public username', async () => {
  // Pre-fix: deleteUserAccount(victimUid, "ownername") would succeed.
  // Now the uid comes from the token; attacker's token + victim's username fails
  // the confirmation (it checks the CALLER's own username).
  const res = await callActionAs(attacker, deleteUserAccount, 'ownername');
  assert.ok('error' in res, 'attacker blocked');

  const victim = await adminDb().collection('users').doc(owner.uid).get();
  assert.equal(victim.exists, true, 'victim profile still intact');

  // Forged token entirely → Unauthorized.
  const forged = await callActionWithRawToken('forged', deleteUserAccount, 'attackername');
  assert.deepEqual(forged, { error: 'Unauthorized' });
});

test('1.3 transferOwnership: non-owner cannot steal a list', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [attacker.uid] });

  // Attacker is a collaborator and tries to transfer ownership to themselves.
  const res = await callActionAs(attacker, transferOwnership, 'L1', attacker.uid);
  assert.ok('error' in res, 'attacker cannot transfer a list they do not own');

  const stolen = await adminDb()
    .collection('users').doc(attacker.uid).collection('lists').doc('L1').get();
  assert.equal(stolen.exists, false, 'no list created under attacker');
  const orig = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.equal(orig.data()?.ownerId, owner.uid, 'ownership unchanged');
});

test('1.4 removeCollaborator: non-owner cannot kick collaborators', async () => {
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'L', ownerId: owner.uid, collaboratorIds: [collab.uid] });

  const attack = await callActionAs(attacker, removeCollaborator, owner.uid, 'L1', collab.uid);
  assert.deepEqual(attack, { error: 'Only the list owner can remove collaborators.' });

  const list1 = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.deepEqual(list1.data()?.collaboratorIds, [collab.uid], 'collaborator still present');

  // Real owner can remove.
  const ok = await callActionAs(owner, removeCollaborator, owner.uid, 'L1', collab.uid);
  assert.equal((ok as any).success, true);
  const list2 = await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1').get();
  assert.deepEqual(list2.data()?.collaboratorIds, [], 'owner removed the collaborator');
});

test('1.6 updateMovieNote: a member cannot spoof/delete another member\'s note', async () => {
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
  await callActionAs(collab, updateMovieNote, owner.uid, 'L1', 'm1', 'collab note');

  const movie = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1')
    .collection('movies').doc('m1').get();
  const notes = movie.data()?.notes || {};
  assert.equal(notes[owner.uid], 'owner note', "owner's note is untouched");
  assert.equal(notes[collab.uid], 'collab note', 'collab wrote only their own note');
});
