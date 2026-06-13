/**
 * LAUNCH 0.5.2 — the loved-lists showcase.
 *
 * `getLovedLists` is a collection-group query over public lists, re-ranked in
 * memory by a recency-weighted score. Asserts:
 *  - the cold-start gate hides the showcase below the minimum;
 *  - only public, liked lists appear;
 *  - a recently-liked list outranks an older, more-liked one (no ossification).
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, adminDb, clearFirestore, clearAuth } from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as lovedListsGet } from '@/app/api/v1/lists/loved/route';

async function getLovedLists(limit?: number) {
  const url = limit !== undefined
    ? `http://test/api/v1/lists/loved?limit=${limit}`
    : 'http://test/api/v1/lists/loved';
  const res = await callRoute<{ lists: unknown[]; gated: boolean }>(
    lovedListsGet, 'GET', { url },
  );
  if (res.body.ok !== true) throw new Error('getLovedLists failed');
  return res.body.data;
}

before(() => { setupTestEnv(); });

/** Seed a list under users/{ownerId}/lists/{listId}. */
async function seedList(
  listId: string,
  opts: { isPublic: boolean; likes: number; ageHours: number; ownerId?: string },
) {
  const ownerId = opts.ownerId ?? 'owner1';
  const lastLikedAt = new Date(Date.now() - opts.ageHours * 3_600_000);
  await adminDb()
    .collection('users').doc(ownerId)
    .collection('lists').doc(listId)
    .set({
      id: listId,
      name: `list ${listId}`,
      ownerId,
      isPublic: opts.isPublic,
      likes: opts.likes,
      likedBy: [],
      lastLikedAt,
      createdAt: lastLikedAt,
      movieCount: 0,
    });
}

beforeEach(async () => { await clearFirestore(); });
after(async () => { await clearFirestore(); await clearAuth(); });

test('cold-start gate hides the showcase below the minimum', async () => {
  await seedList('a', { isPublic: true, likes: 3, ageHours: 1 });
  await seedList('b', { isPublic: true, likes: 2, ageHours: 1 });
  const res = await getLovedLists();
  assert.equal(res.gated, true, 'gated below 3 liked lists');
  assert.deepEqual(res.lists, []);
});

test('above the threshold, returns liked public lists', async () => {
  await seedList('a', { isPublic: true, likes: 5, ageHours: 1 });
  await seedList('b', { isPublic: true, likes: 4, ageHours: 1 });
  await seedList('c', { isPublic: true, likes: 3, ageHours: 1 });
  const res = await getLovedLists();
  assert.equal(res.gated, false);
  assert.equal(res.lists.length, 3);
});

test('private lists and unliked lists are excluded', async () => {
  await seedList('p1', { isPublic: true, likes: 5, ageHours: 1 });
  await seedList('p2', { isPublic: true, likes: 4, ageHours: 1 });
  await seedList('p3', { isPublic: true, likes: 3, ageHours: 1 });
  await seedList('private', { isPublic: false, likes: 99, ageHours: 1 });
  await seedList('unliked', { isPublic: true, likes: 0, ageHours: 1 });
  const res = await getLovedLists();
  const ids = res.lists.map((l: any) => l.id);
  assert.ok(!ids.includes('private'), 'private list excluded');
  assert.ok(!ids.includes('unliked'), 'unliked list excluded');
  assert.equal(res.lists.length, 3);
});

test('a recently-liked list outranks an older, more-liked one', async () => {
  await seedList('fresh', { isPublic: true, likes: 4, ageHours: 1 });
  await seedList('mid', { isPublic: true, likes: 8, ageHours: 120 });
  await seedList('old-popular', { isPublic: true, likes: 20, ageHours: 720 });
  const res = await getLovedLists();
  assert.equal(res.lists[0].id, 'fresh', 'recency beats raw like count');
  assert.equal(res.lists[2].id, 'old-popular', 'the stale popular list sinks');
});
