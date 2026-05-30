/**
 * Phase A.3 PR #6 — collaborators-namespace endpoint tests.
 *
 * Covers:
 *   - DELETE /api/v1/lists/[ownerId]/[listId]/collaborators/[uid]   removeCollaborator
 *   - POST   /api/v1/lists/[ownerId]/[listId]/leave                 leaveList
 *
 * AUDIT regression:
 *   - 1.4 — `removeCollaborator` compares the STORED ownerId against the
 *     verified caller. The legacy tautological check (`ownerId param ===
 *     ownerId param`) is structurally impossible to reintroduce now: the
 *     helper only ever uses the verified-token uid as the comparison anchor.
 *     The bigger 1.4 invariant test lives in `07-special-cases-auth.test.ts`;
 *     this file pins the route-level details.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { DELETE as removeCollabDelete }
  from '@/app/api/v1/lists/[ownerId]/[listId]/collaborators/[uid]/route';
import { POST as leavePost }
  from '@/app/api/v1/lists/[ownerId]/[listId]/leave/route';

let owner: TestUser, collab: TestUser, stranger: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  collab = await createTestUser('collab');
  stranger = await createTestUser('stranger');
});

after(async () => { await clearFirestore(); await clearAuth(); });

const LIST_ID = 'L1';
const listRef = () => adminDb()
  .collection('users').doc(owner.uid)
  .collection('lists').doc(LIST_ID);

async function seedList(collaboratorIds: string[] = [collab.uid]) {
  await listRef().set({
    id: LIST_ID, name: 'A list', ownerId: owner.uid,
    collaboratorIds, isPublic: false,
  });
}

// ─── DELETE /collaborators/[uid] ─────────────────────────────────────────

test('DELETE /collaborators/[uid]: unauth → 401', async () => {
  await seedList();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    params: { ownerId: owner.uid, listId: LIST_ID, uid: collab.uid },
  });
  assert.equal(res.status, 401);
});

test('DELETE /collaborators/[uid]: stranger → 403 (AUDIT 1.4 — verified caller is not owner)', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: LIST_ID, uid: collab.uid },
  });
  assert.equal(res.status, 403);
  const data = (await listRef().get()).data();
  assert.deepEqual(data?.collaboratorIds, [collab.uid], 'collaborator untouched');
});

test('DELETE /collaborators/[uid]: collaborator cannot kick another collaborator → 403', async () => {
  // Two collaborators on the list. One tries to kick the other.
  const collab2 = await createTestUser('collab2');
  await seedList([collab.uid, collab2.uid]);
  const token = await collab.getIdToken();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: LIST_ID, uid: collab2.uid },
  });
  assert.equal(res.status, 403);
});

test('DELETE /collaborators/[uid]: owner removes successfully', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: LIST_ID, uid: collab.uid },
  });
  assert.equal(res.status, 200);
  const data = (await listRef().get()).data();
  assert.deepEqual(data?.collaboratorIds, []);
});

test('DELETE /collaborators/[uid]: removing a non-member is a no-op (idempotent)', async () => {
  await seedList([]);
  const token = await owner.getIdToken();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: LIST_ID, uid: 'never-was-a-member' },
  });
  // arrayRemove is idempotent at the Firestore level; the route returns success.
  assert.equal(res.status, 200);
});

test('DELETE /collaborators/[uid]: missing list → 404', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute(removeCollabDelete, 'DELETE', {
    token, params: { ownerId: owner.uid, listId: 'no-such-list', uid: collab.uid },
  });
  assert.equal(res.status, 404);
});

// ─── POST /leave ─────────────────────────────────────────────────────────

test('POST /leave: unauth → 401', async () => {
  await seedList();
  const res = await callRoute(leavePost, 'POST', {
    params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 401);
});

test('POST /leave: owner cannot leave own list → 400', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(leavePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 400);
});

test('POST /leave: stranger (not a collaborator) → 403', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(leavePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 403);
});

test('POST /leave: collaborator successfully leaves', async () => {
  await seedList();
  const token = await collab.getIdToken();
  const res = await callRoute(leavePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 200);
  const data = (await listRef().get()).data();
  assert.deepEqual(data?.collaboratorIds, [], 'collaborator removed themselves');
});

test('POST /leave: missing list → 404', async () => {
  const token = await collab.getIdToken();
  const res = await callRoute(leavePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: 'nope' },
  });
  assert.equal(res.status, 404);
});
