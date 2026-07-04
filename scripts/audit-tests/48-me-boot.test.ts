/**
 * `GET /api/v1/me/boot` (batched boot payload) + `GET /api/v1/me/following-ids`
 * (full follow graph as a uid array). Both authed; boot composes the bookmarks
 * + mutes + block-context helpers into one call.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as bootGet } from '@/app/api/v1/me/boot/route';
import { GET as followingIdsGet } from '@/app/api/v1/me/following-ids/route';

let me_: TestUser, alice: TestUser;

before(() => { setupTestEnv(); });
beforeEach(async () => {
  await clearFirestore();
  me_ = await createTestUser('me');
  alice = await createTestUser('alice');
});
after(async () => { await clearFirestore(); await clearAuth(); });

test('GET /me/boot: unauth → 401', async () => {
  const res = await callRoute(bootGet, 'GET', { url: 'http://test/api/v1/me/boot' });
  assert.equal(res.status, 401);
});

test('GET /me/boot: returns the three slices in one call', async () => {
  const token = await me_.getIdToken();
  const res = await callRoute<{
    bookmarks: { keys: string[] };
    mutes: { mutedIds: string[] };
    blocks: { blockedIds: string[]; iBlocked: string[] };
  }>(bootGet, 'GET', { token, url: 'http://test/api/v1/me/boot' });
  assert.equal(res.body.ok, true);
  if (res.body.ok !== true) return;
  assert.ok(Array.isArray(res.body.data.bookmarks.keys));
  assert.ok(Array.isArray(res.body.data.mutes.mutedIds));
  assert.ok(Array.isArray(res.body.data.blocks.blockedIds));
  assert.ok(Array.isArray(res.body.data.blocks.iBlocked));
});

test('GET /me/boot: reflects a seeded block + mute', async () => {
  // me blocks alice + mutes alice
  await adminDb().collection('blocks').doc(`${me_.uid}_${alice.uid}`)
    .set({ blockerId: me_.uid, blockedId: alice.uid, createdAt: new Date() });
  await adminDb().collection('users').doc(me_.uid).collection('mutes').doc(alice.uid)
    .set({ mutedId: alice.uid, createdAt: new Date() });

  const token = await me_.getIdToken();
  const res = await callRoute<{
    mutes: { mutedIds: string[] };
    blocks: { blockedIds: string[]; iBlocked: string[] };
  }>(bootGet, 'GET', { token, url: 'http://test/api/v1/me/boot' });
  if (res.body.ok !== true) throw new Error('boot failed');
  assert.ok(res.body.data.blocks.iBlocked.includes(alice.uid), 'block reflected');
  assert.ok(res.body.data.mutes.mutedIds.includes(alice.uid), 'mute reflected');
});

test('GET /me/following-ids: unauth → 401', async () => {
  const res = await callRoute(followingIdsGet, 'GET', { url: 'http://test/api/v1/me/following-ids' });
  assert.equal(res.status, 401);
});

test('GET /me/following-ids: returns the caller\'s follow graph as uids', async () => {
  await adminDb().collection('users').doc(me_.uid)
    .collection('following').doc(alice.uid).set({ followingId: alice.uid, createdAt: new Date() });
  const token = await me_.getIdToken();
  const res = await callRoute<{ ids: string[] }>(
    followingIdsGet, 'GET', { token, url: 'http://test/api/v1/me/following-ids' },
  );
  if (res.body.ok !== true) throw new Error('following-ids failed');
  assert.ok(res.body.data.ids.includes(alice.uid));
});
