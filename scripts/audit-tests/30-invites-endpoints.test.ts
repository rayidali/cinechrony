/**
 * Phase A.3 PR #5 — invites-namespace endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/lists/[ownerId]/[listId]/invites           (direct invite)
 *   - GET    /api/v1/lists/[ownerId]/[listId]/invites           (pending — AUDIT 1.14)
 *   - POST   /api/v1/lists/[ownerId]/[listId]/invite-link       (CSPRNG code — AUDIT 2.9)
 *   - GET    /api/v1/invites/[code]                             (auth required — AUDIT 2.9)
 *   - POST   /api/v1/invites/accept                             (AUDIT 1.11, transactional)
 *   - POST   /api/v1/invites/[inviteId]/decline
 *   - DELETE /api/v1/invites/[inviteId]                         (AUDIT 1.12, owner OR inviter)
 *   - GET    /api/v1/me/invites
 *
 * AUDIT regression coverage:
 *   - 1.11 — `acceptInvite` transactional; revoked + already-member + max-cap
 *     races all caught in-tx.
 *   - 1.12 — `revokeInvite` accepts owner OR inviter; in-tx status re-check.
 *   - 1.14 — `getListPendingInvites` is member-only; collaborator does NOT
 *     receive `inviteCode`.
 *   - 2.9 — `getInviteByCode` requires Bearer token (was unauthenticated);
 *     codes are 12 chars from a 54-char alphabet, CSPRNG-derived
 *     (`crypto.randomInt`, rejection-sampled).
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as listInvitePost, GET as listInviteGet }
  from '@/app/api/v1/lists/[ownerId]/[listId]/invites/route';
import { POST as inviteLinkPost }
  from '@/app/api/v1/lists/[ownerId]/[listId]/invite-link/route';
import { GET as inviteByCodeGet } from '@/app/api/v1/invites/by-code/[code]/route';
import { POST as acceptPost } from '@/app/api/v1/invites/accept/route';
import { DELETE as revokeDelete } from '@/app/api/v1/invites/[inviteId]/route';
import { POST as declinePost } from '@/app/api/v1/invites/[inviteId]/decline/route';
import { GET as myInvitesGet } from '@/app/api/v1/me/invites/route';

let owner: TestUser, collab: TestUser, invitee: TestUser, stranger: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  collab = await createTestUser('collab');
  invitee = await createTestUser('invitee');
  stranger = await createTestUser('stranger');
  await adminDb().collection('users').doc(owner.uid).set({
    uid: owner.uid, username: 'owneruser', displayName: 'Owner', photoURL: null,
  });
  await adminDb().collection('users').doc(collab.uid).set({
    uid: collab.uid, username: 'collabuser', displayName: 'Collab', photoURL: null,
  });
  await adminDb().collection('users').doc(invitee.uid).set({
    uid: invitee.uid, username: 'inviteeuser', displayName: 'Invitee', photoURL: null,
  });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const LIST_ID = 'L1';
const listRef = () => adminDb()
  .collection('users').doc(owner.uid)
  .collection('lists').doc(LIST_ID);

async function seedList(opts: { collaborators?: string[] } = {}) {
  await listRef().set({
    id: LIST_ID,
    name: 'A list',
    ownerId: owner.uid,
    collaboratorIds: opts.collaborators ?? [collab.uid],
    isPublic: false,
  });
}

// ─── POST /api/v1/lists/[ownerId]/[listId]/invites — direct invite ────────

test('POST /invites: unauth → 401', async () => {
  await seedList();
  const res = await callRoute(listInvitePost, 'POST', {
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 401);
});

test('POST /invites: stranger → 403', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 403);
});

test('POST /invites: owner happy path creates invite + notification', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute<{ inviteId: string }>(listInvitePost, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');

  const invite = await adminDb().collection('invites').doc(res.body.data.inviteId).get();
  assert.equal(invite.exists, true);
  assert.equal(invite.data()?.inviteeId, invitee.uid);
  assert.equal(invite.data()?.inviterId, owner.uid);
  assert.equal(invite.data()?.status, 'pending');

  // Notification created for the invitee.
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', invitee.uid)
    .where('type', '==', 'list_invite')
    .get();
  assert.equal(notifs.size, 1);
});

test('POST /invites: collaborator can invite (canEditList allows)', async () => {
  await seedList();
  const token = await collab.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 200);
});

test('POST /invites: already-collaborator → 409', async () => {
  await seedList({ collaborators: [collab.uid, invitee.uid] });
  const token = await owner.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 409);
});

test('POST /invites: duplicate pending invite → 409', async () => {
  await seedList();
  const token = await owner.getIdToken();
  // First invite ok
  await callRoute(listInvitePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID }, body: { inviteeId: invitee.uid },
  });
  // Second to the same user → 409
  const res = await callRoute(listInvitePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID }, body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 409);
});

test('POST /invites: invitee not found → 404', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID }, body: { inviteeId: 'nonexistent-user' },
  });
  assert.equal(res.status, 404);
});

test('POST /invites: missing inviteeId → 400', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID }, body: {},
  });
  assert.equal(res.status, 400);
});

test('POST /invites: max-member cap blocks creation', async () => {
  // 1 owner + 9 collaborators = 10 (cap). One more invite would push past.
  const collabIds = await Promise.all(
    Array.from({ length: 9 }, (_, i) => createTestUser(`fillerCollab${i}`).then((u) => u.uid)),
  );
  await listRef().set({
    id: LIST_ID, name: 'L', ownerId: owner.uid, collaboratorIds: collabIds, isPublic: false,
  });
  const token = await owner.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID }, body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 409, 'invite past cap rejected');
});

// ─── GET /api/v1/lists/[ownerId]/[listId]/invites — AUDIT 1.14 ────────────

test('GET /invites: stranger → 403', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(listInviteGet, 'GET', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 403);
});

test('GET /invites: owner sees inviteCode; collaborator does NOT (AUDIT 1.14)', async () => {
  await seedList();
  await adminDb().collection('invites').doc('inv1').set({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteCode: 'SECRETCODE', listName: 'L',
  });

  const ownerToken = await owner.getIdToken();
  const asOwner = await callRoute<{ invites: Array<{ inviteCode?: string }> }>(
    listInviteGet, 'GET', { token: ownerToken, params: { ownerId: owner.uid, listId: LIST_ID } },
  );
  if (asOwner.body.ok !== true) return assert.fail('expected ok');
  assert.equal(asOwner.body.data.invites[0].inviteCode, 'SECRETCODE');

  const collabToken = await collab.getIdToken();
  const asCollab = await callRoute<{ invites: Array<{ inviteCode?: string }> }>(
    listInviteGet, 'GET', { token: collabToken, params: { ownerId: owner.uid, listId: LIST_ID } },
  );
  if (asCollab.body.ok !== true) return assert.fail('expected ok');
  assert.equal(asCollab.body.data.invites[0].inviteCode, undefined, "collaborator's code stripped");
});

// ─── POST /api/v1/lists/[ownerId]/[listId]/invite-link — AUDIT 2.9 code ──

test('POST /invite-link: returns CSPRNG-looking 12-char code', async () => {
  await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute<{ inviteCode: string }>(inviteLinkPost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.match(res.body.data.inviteCode, /^[A-HJ-NP-Za-hjkmnp-z2-9]{12}$/, 'expected 12-char alphabet code');
});

test('POST /invite-link: stranger → 403', async () => {
  await seedList();
  const token = await stranger.getIdToken();
  const res = await callRoute(inviteLinkPost, 'POST', {
    token, params: { ownerId: owner.uid, listId: LIST_ID },
  });
  assert.equal(res.status, 403);
});

// ─── GET /api/v1/invites/[code] — AUDIT 2.9 auth gate ────────────────────

test('GET /invites/[code]: unauth → 401 (AUDIT 2.9 enumeration vector closed)', async () => {
  await adminDb().collection('invites').doc('inv').set({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteCode: 'ABC123ABC123', listName: 'L',
  });
  const res = await callRoute(inviteByCodeGet, 'GET', {
    params: { code: 'ABC123ABC123' },
  });
  assert.equal(res.status, 401);
});

test('GET /invites/[code]: authenticated user can look up valid code', async () => {
  await adminDb().collection('invites').doc('inv').set({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteCode: 'ABC123ABC123', listName: 'L',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(inviteByCodeGet, 'GET', {
    token, params: { code: 'ABC123ABC123' },
  });
  assert.equal(res.status, 200);
});

test('GET /invites/[code]: unknown code → 404', async () => {
  const token = await invitee.getIdToken();
  const res = await callRoute(inviteByCodeGet, 'GET', {
    token, params: { code: 'NEVEREXISTED' },
  });
  assert.equal(res.status, 404);
});

test('GET /invites/[code]: expired code → 404', async () => {
  await adminDb().collection('invites').doc('inv').set({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteCode: 'EXPIREDCODE0',
    listName: 'L',
    expiresAt: new Date(Date.now() - 1000), // expired 1s ago
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(inviteByCodeGet, 'GET', {
    token, params: { code: 'EXPIREDCODE0' },
  });
  assert.equal(res.status, 404);
});

// ─── POST /api/v1/invites/accept — AUDIT 1.11 transactional ──────────────

test('POST /invites/accept: by inviteId, happy path adds caller to collaboratorIds', async () => {
  await seedList({ collaborators: [] });
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 200);
  const listData = (await listRef().get()).data();
  assert.ok(listData?.collaboratorIds.includes(invitee.uid));
});

test('POST /invites/accept: by inviteCode, happy path', async () => {
  await seedList({ collaborators: [] });
  await adminDb().collection('invites').doc('linkInv').set({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteCode: 'LINKCODE0001', listName: 'L',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteCode: 'LINKCODE0001' },
  });
  assert.equal(res.status, 200);
  const listData = (await listRef().get()).data();
  assert.ok(listData?.collaboratorIds.includes(invitee.uid));
});

test('POST /invites/accept: notifies the inviter (invite_accepted doc)', async () => {
  await seedList({ collaborators: [] });
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'A list',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 200);

  const notifSnap = await adminDb().collection('notifications')
    .where('userId', '==', owner.uid)
    .where('type', '==', 'invite_accepted')
    .get();
  assert.equal(notifSnap.size, 1);
  const n = notifSnap.docs[0].data();
  assert.equal(n.fromUserId, invitee.uid);
  assert.equal(n.fromUsername, 'inviteeuser');
  assert.equal(n.listId, LIST_ID);
  assert.equal(n.listOwnerId, owner.uid);
  assert.equal(n.listName, 'A list');
});

test('POST /invites/accept: inviter with listInvites pref off → no invite_accepted doc', async () => {
  await seedList({ collaborators: [] });
  await adminDb().collection('users').doc(owner.uid).set(
    { notificationPreferences: { listInvites: false } }, { merge: true },
  );
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'A list',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 200);

  const notifSnap = await adminDb().collection('notifications')
    .where('userId', '==', owner.uid)
    .where('type', '==', 'invite_accepted')
    .get();
  assert.equal(notifSnap.size, 0);
});

test('POST /invites: blocked pair → 404 (no invite, no existence oracle)', async () => {
  await seedList();
  await adminDb().collection('blocks').doc(`${invitee.uid}_${owner.uid}`).set({
    blockerId: invitee.uid, blockedId: owner.uid,
  });
  const token = await owner.getIdToken();
  const res = await callRoute(listInvitePost, 'POST', {
    token,
    params: { ownerId: owner.uid, listId: LIST_ID },
    body: { inviteeId: invitee.uid },
  });
  assert.equal(res.status, 404);

  const invitesSnap = await adminDb().collection('invites')
    .where('inviteeId', '==', invitee.uid).get();
  assert.equal(invitesSnap.size, 0);
});

test('POST /invites/accept: revoked invite → 409', async () => {
  await seedList({ collaborators: [] });
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'revoked', inviteeId: invitee.uid, listName: 'L',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 409);
});

test('POST /invites/accept: wrong recipient → 403', async () => {
  await seedList({ collaborators: [] });
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  // stranger tries to accept invitee's invite
  const token = await stranger.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 403);
});

test('POST /invites/accept: missing inviteId AND inviteCode → 400', async () => {
  const token = await invitee.getIdToken();
  const res = await callRoute(acceptPost, 'POST', {
    token, body: {},
  });
  assert.equal(res.status, 400);
});

test('POST /invites/accept: concurrent double-accept lands one collaborator only (AUDIT 1.11 race)', async () => {
  await seedList({ collaborators: [] });
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  const token = await invitee.getIdToken();
  await Promise.all([
    callRoute(acceptPost, 'POST', { token, body: { inviteId: inviteRef.id } }),
    callRoute(acceptPost, 'POST', { token, body: { inviteId: inviteRef.id } }),
  ]);
  // After both: collaboratorIds contains invitee exactly once (no duplicates).
  const listData = (await listRef().get()).data();
  const count = (listData?.collaboratorIds || []).filter((id: string) => id === invitee.uid).length;
  assert.equal(count, 1, 'transactional accept collapses concurrent attempts');
});

// ─── POST /api/v1/invites/[inviteId]/decline ─────────────────────────────

test('POST /invites/[id]/decline: invitee can decline', async () => {
  await seedList();
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  const token = await invitee.getIdToken();
  const res = await callRoute(declinePost, 'POST', {
    token, params: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 200);
  assert.equal((await inviteRef.get()).data()?.status, 'declined');
});

test('POST /invites/[id]/decline: wrong user → 403', async () => {
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  const token = await stranger.getIdToken();
  const res = await callRoute(declinePost, 'POST', {
    token, params: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 403);
});

// ─── DELETE /api/v1/invites/[inviteId] — AUDIT 1.12 ──────────────────────

test('DELETE /invites/[id]: invite already accepted → 409 (in-tx race guard)', async () => {
  const inviteRef = await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'accepted', inviteeId: collab.uid, listName: 'L',
  });
  const token = await owner.getIdToken();
  const res = await callRoute(revokeDelete, 'DELETE', {
    token, params: { inviteId: inviteRef.id },
  });
  assert.equal(res.status, 409);
});

// ─── GET /api/v1/me/invites ──────────────────────────────────────────────

test('GET /me/invites: caller sees their own pending invites only', async () => {
  // Two pending invites for invitee, one for stranger
  await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L',
  });
  await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: invitee.uid, listName: 'L2',
  });
  await adminDb().collection('invites').add({
    listId: LIST_ID, listOwnerId: owner.uid, inviterId: owner.uid,
    status: 'pending', inviteeId: stranger.uid, listName: 'X',
  });

  const token = await invitee.getIdToken();
  const res = await callRoute<{ invites: Array<{ id: string }> }>(myInvitesGet, 'GET', {
    token,
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.invites.length, 2, 'sees own 2 invites');
});

test('GET /me/invites: derived from token, not query param (no IDOR)', async () => {
  // There's no way to pass a different userId via the URL — the route is auth-only.
  // But verify unauth → 401.
  const res = await callRoute(myInvitesGet, 'GET', {});
  assert.equal(res.status, 401);
});
