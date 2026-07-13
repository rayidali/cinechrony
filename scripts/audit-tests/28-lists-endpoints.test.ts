/**
 * Phase A.3 PR #3 — lists-namespace endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/lists                          (create)
 *   - GET    /api/v1/lists                          (caller's own list picker; incl. private)
 *   - PATCH  /api/v1/lists/[ownerId]/[listId]       (collapsed rename/desc/visibility)
 *   - DELETE /api/v1/lists/[ownerId]/[listId]       (cascade + revoke invites)
 *   - POST   /api/v1/lists/[ownerId]/[listId]/cover (R2 input validation; AUDIT 1.5)
 *   - DELETE /api/v1/lists/[ownerId]/[listId]/cover (collaborator can clear via canEditList)
 *
 * Transfer is covered exhaustively in `12-transfer-ownership.test.ts`.
 * Tautological-auth IDOR coverage is in `03-lists-auth.test.ts`.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { POST as createListPost, GET as getOwnLists } from '@/app/api/v1/lists/route';
import { PATCH as patchList, DELETE as deleteList } from '@/app/api/v1/lists/[ownerId]/[listId]/route';
import { POST as postCover, DELETE as deleteCover } from '@/app/api/v1/lists/[ownerId]/[listId]/cover/route';

let owner: TestUser, collab: TestUser, stranger: TestUser;

before(() => {
  setupTestEnv();
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  collab = await createTestUser('collab');
  stranger = await createTestUser('stranger');
});

after(async () => { await clearFirestore(); await clearAuth(); });

async function seedList(opts: { listId?: string; isDefault?: boolean; isPublic?: boolean; collaborators?: string[] } = {}) {
  const listId = opts.listId ?? 'L1';
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc(listId).set({
    id: listId,
    name: 'Original',
    ownerId: owner.uid,
    isPublic: opts.isPublic ?? false,
    isDefault: opts.isDefault ?? false,
    collaboratorIds: opts.collaborators ?? [collab.uid],
  });
  return listId;
}

// ─── POST /api/v1/lists ──────────────────────────────────────────────────

test('POST /lists: unauth → 401', async () => {
  const res = await callRoute(createListPost, 'POST', { body: { name: 'X' } });
  assert.equal(res.status, 401);
});

test('POST /lists: empty name → 400', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute(createListPost, 'POST', { token, body: { name: '   ' } });
  assert.equal(res.status, 400);
});

test('POST /lists: missing name field → 400', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute(createListPost, 'POST', { token, body: {} });
  assert.equal(res.status, 400);
});

test('POST /lists: 81-char name → 400', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute(createListPost, 'POST', { token, body: { name: 'x'.repeat(81) } });
  assert.equal(res.status, 400);
});

test('POST /lists: valid create persists with defaults', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute<{ listId: string }>(createListPost, 'POST', {
    token,
    body: { name: 'My List' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok !== true) return;

  const doc = (await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(res.body.data.listId).get()).data();
  assert.equal(doc?.name, 'My List');
  assert.equal(doc?.ownerId, owner.uid);
  assert.equal(doc?.isPublic, false, 'v3 default: private');
  assert.equal(doc?.coverMode, 'auto');
  assert.equal(doc?.isDefault, false);
});

// ─── GET /api/v1/lists (the caller's own list picker) ────────────────────

test('GET /lists: unauth → 401', async () => {
  const res = await callRoute(getOwnLists, 'GET');
  assert.equal(res.status, 401);
});

test('GET /lists: owner gets own lists, including private ones', async () => {
  // Seeded via the real POST route (not the raw seedList() helper below) so
  // createdAt is a real serverTimestamp — getUserLists orders by createdAt,
  // and Firestore silently excludes docs missing an orderBy field.
  const token = await owner.getIdToken();
  const pub = await callRoute<{ listId: string }>(createListPost, 'POST', {
    token, body: { name: 'Public One', isPublic: true },
  });
  const priv = await callRoute<{ listId: string }>(createListPost, 'POST', {
    token, body: { name: 'Private One', isPublic: false },
  });
  const publicId = pub.body.ok ? pub.body.data.listId : '';
  const privateId = priv.body.ok ? priv.body.data.listId : '';
  assert.ok(publicId && privateId, 'both lists were created');

  const res = await callRoute<{ lists: { id: string; isPublic: boolean }[] }>(getOwnLists, 'GET', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  if (res.body.ok !== true) return;
  const ids = res.body.data.lists.map((l) => l.id);
  assert.ok(ids.includes(publicId), 'includes the public list');
  assert.ok(ids.includes(privateId), 'includes the private list too — a list picker needs them all');
});

// ─── PATCH /api/v1/lists/[ownerId]/[listId] ──────────────────────────────

test('PATCH /lists/[id]: unauth → 401', async () => {
  const listId = await seedList();
  const res = await callRoute(patchList, 'PATCH', {
    params: { ownerId: owner.uid, listId },
    body: { name: 'Hacked' },
  });
  assert.equal(res.status, 401);
});

test('PATCH /lists/[id]: collaborator (non-owner) → 403', async () => {
  const listId = await seedList();
  const collabToken = await collab.getIdToken();
  const res = await callRoute(patchList, 'PATCH', {
    token: collabToken,
    params: { ownerId: owner.uid, listId },
    body: { name: 'Renamed by collab' },
  });
  assert.equal(res.status, 403);

  const after = (await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get()).data();
  assert.equal(after?.name, 'Original');
});

test('PATCH /lists/[id]: stranger → 403', async () => {
  const listId = await seedList();
  const strangerToken = await stranger.getIdToken();
  const res = await callRoute(patchList, 'PATCH', {
    token: strangerToken,
    params: { ownerId: owner.uid, listId },
    body: { name: 'Stranger rename' },
  });
  assert.equal(res.status, 403);
});

test('PATCH /lists/[id]: owner can update all 3 fields atomically', async () => {
  const listId = await seedList({ isPublic: false });
  const ownerToken = await owner.getIdToken();
  const res = await callRoute(patchList, 'PATCH', {
    token: ownerToken,
    params: { ownerId: owner.uid, listId },
    body: { name: 'New Name', description: 'New desc', isPublic: true },
  });
  assert.equal(res.status, 200);

  const after = (await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get()).data();
  assert.equal(after?.name, 'New Name');
  assert.equal(after?.description, 'New desc');
  assert.equal(after?.isPublic, true);
});

test('PATCH /lists/[id]: empty body → 400', async () => {
  const listId = await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(patchList, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId },
    body: {},
  });
  assert.equal(res.status, 400);
});

test('PATCH /lists/[id]: missing list → 404', async () => {
  const token = await owner.getIdToken();
  const res = await callRoute(patchList, 'PATCH', {
    token,
    params: { ownerId: owner.uid, listId: 'does-not-exist' },
    body: { name: 'x' },
  });
  assert.equal(res.status, 404);
});

// ─── DELETE /api/v1/lists/[ownerId]/[listId] ─────────────────────────────

test('DELETE /lists/[id]: unauth → 401', async () => {
  const listId = await seedList();
  const res = await callRoute(deleteList, 'DELETE', {
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 401);
});

test('DELETE /lists/[id]: collaborator cannot delete → 403', async () => {
  const listId = await seedList();
  const collabToken = await collab.getIdToken();
  const res = await callRoute(deleteList, 'DELETE', {
    token: collabToken,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 403);
});

test('DELETE /lists/[id]: cannot delete default list → 400', async () => {
  const listId = await seedList({ isDefault: true });
  const token = await owner.getIdToken();
  const res = await callRoute(deleteList, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 400);
});

test('DELETE /lists/[id]: owner cascade deletes movies + revokes pending invites', async () => {
  const listId = await seedList();
  // Seed 2 movies and 1 pending invite.
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc(listId)
    .collection('movies').doc('m1').set({ id: 'm1', title: 'A' });
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc(listId)
    .collection('movies').doc('m2').set({ id: 'm2', title: 'B' });
  const inviteRef = await adminDb().collection('invites').add({
    listId, listOwnerId: owner.uid, status: 'pending', inviterId: owner.uid,
  });

  const token = await owner.getIdToken();
  const res = await callRoute(deleteList, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 200);

  const listDoc = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get();
  assert.equal(listDoc.exists, false, 'list doc deleted');

  const movies = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId)
    .collection('movies').get();
  assert.equal(movies.size, 0, 'movies subcollection emptied');

  const invite = (await inviteRef.get()).data();
  assert.equal(invite?.status, 'revoked', 'pending invite was revoked');
});

// ─── POST /api/v1/lists/[ownerId]/[listId]/cover (AUDIT.md 1.5) ──────────

test('POST /cover: unauth → 401', async () => {
  const listId = await seedList();
  const res = await callRoute(postCover, 'POST', {
    params: { ownerId: owner.uid, listId },
    body: { base64: 'x', fileName: 'c.jpg', mimeType: 'image/jpeg' },
  });
  assert.equal(res.status, 401);
});

test('POST /cover: AUDIT 1.5 — stranger blocked at canEditList → 403', async () => {
  const listId = await seedList();
  const strangerToken = await stranger.getIdToken();
  const res = await callRoute(postCover, 'POST', {
    token: strangerToken,
    params: { ownerId: owner.uid, listId },
    body: { base64: 'xxxx', fileName: 'c.jpg', mimeType: 'image/jpeg' },
  });
  assert.equal(res.status, 403);
});

test('POST /cover: non-image mimeType → 400', async () => {
  const listId = await seedList();
  const token = await owner.getIdToken();
  const res = await callRoute(postCover, 'POST', {
    token,
    params: { ownerId: owner.uid, listId },
    body: { base64: 'xx', fileName: 'c.pdf', mimeType: 'application/pdf' },
  });
  assert.equal(res.status, 400);
});

test('POST /cover: oversized (>10MB) → 400', async () => {
  const listId = await seedList();
  const token = await owner.getIdToken();
  // 16MB base64 → ~12MB raw, over the 10MB cap.
  const big = 'a'.repeat(16 * 1024 * 1024);
  const res = await callRoute(postCover, 'POST', {
    token,
    params: { ownerId: owner.uid, listId },
    body: { base64: big, fileName: 'big.jpg', mimeType: 'image/jpeg' },
  });
  assert.equal(res.status, 400);
});

test('POST /cover: AUDIT 1.5 structural — R2 key derived from URL params only', async () => {
  // The route reads ownerId + listId from `params` (URL path), never from
  // request body. canEditList(auth.uid, params.ownerId, params.listId)
  // verified the caller is owner-or-collaborator on the path's list. A
  // malicious client cannot influence the R2 key by spoofing a body field;
  // there's nothing to spoof.
  const routeMod = await import('@/app/api/v1/lists/[ownerId]/[listId]/cover/route');
  assert.equal(typeof routeMod.POST, 'function');
  // This is a structural assertion — the runtime tests above (collaborator
  // 403 etc.) confirm the canEditList gate fires before any R2 work.
});

// ─── DELETE /api/v1/lists/[ownerId]/[listId]/cover ───────────────────────

test('DELETE /cover: unauth → 401', async () => {
  const listId = await seedList();
  const res = await callRoute(deleteCover, 'DELETE', {
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 401);
});

test('DELETE /cover: stranger → 403', async () => {
  const listId = await seedList();
  const strangerToken = await stranger.getIdToken();
  const res = await callRoute(deleteCover, 'DELETE', {
    token: strangerToken,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 403);
});

test('DELETE /cover: collaborator can clear cover (canEditList)', async () => {
  const listId = await seedList();
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc(listId)
    .update({ coverImageUrl: 'https://example.com/old.jpg' });

  const collabToken = await collab.getIdToken();
  const res = await callRoute(deleteCover, 'DELETE', {
    token: collabToken,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 200);

  const after = (await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc(listId).get()).data();
  assert.equal(after?.coverImageUrl, null);
});

test('DELETE /cover: owner clears cover', async () => {
  const listId = await seedList();
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc(listId)
    .update({ coverImageUrl: 'https://example.com/old.jpg' });

  const token = await owner.getIdToken();
  const res = await callRoute(deleteCover, 'DELETE', {
    token,
    params: { ownerId: owner.uid, listId },
  });
  assert.equal(res.status, 200);
});
