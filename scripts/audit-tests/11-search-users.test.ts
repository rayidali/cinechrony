/**
 * Phase 2.8 + Phase A PR #14 — searchUsers via /api/v1/users/search.
 *
 * The post-AUDIT-2.8 prefix-range optimization is preserved; this test now
 * exercises it through the route handler. The route is `publicApiRoute`
 * (no token required) but auth-aware — viewer self-exclusion + block
 * filtering kick in when a Bearer token is present.
 *
 * Asserts the post-fix correctness contract:
 *  - prefix on usernameLower finds the user
 *  - prefix on displayNameLower finds the user (different field)
 *  - excludes the viewer (when authenticated)
 *  - dedupes when both fields match the same user
 *  - ignores a non-matching legacy user (no false positives)
 *  - 2-char minimum stays
 *  - email is NEVER returned (1.9 — email lives in /users_private)
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';
import { GET as searchGet } from '@/app/api/v1/users/search/route';

let me: TestUser;

before(() => { setupTestEnv(); });

async function search(query: string, viewer?: TestUser) {
  const url = `http://test/api/v1/users/search?q=${encodeURIComponent(query)}`;
  const res = await callRoute<{ users: Array<{ uid: string; email: string; username: string | null }> }>(
    searchGet, 'GET',
    { token: viewer ? await viewer.getIdToken() : undefined, url },
  );
  if (res.body.ok !== true) throw new Error(`search failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

beforeEach(async () => {
  await clearFirestore();
  me = await createTestUser('me');

  const seed = async (uid: string, username: string, displayName: string) => {
    await adminDb().collection('users').doc(uid).set({
      uid, username, usernameLower: username.toLowerCase(),
      displayName, displayNameLower: displayName.toLowerCase(),
    });
  };
  await seed('u_alice', 'alicehandle', 'Alice Smith');
  await seed('u_alex',  'alexcat',     'Alex Park');
  await seed('u_bob',   'bobby',       'Bob Jones');
  await seed('u_zoe',   'zoenobody',   'Zoe Alice Lane');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('prefix on usernameLower returns starts-with matches only', async () => {
  const { users } = await search('al');
  const uids = users.map((u) => u.uid).sort();
  assert.deepEqual(uids, ['u_alex', 'u_alice'].sort(), `unexpected: ${JSON.stringify(uids)}`);
  assert.equal(users.find((u) => u.uid === 'u_bob'), undefined, 'bob excluded');
});

test('prefix on displayNameLower picks up matches not in username', async () => {
  const { users } = await search('zoe');
  assert.ok(users.map((u) => u.uid).includes('u_zoe'));
});

test('viewer is filtered out of results (Bearer-token-derived)', async () => {
  await adminDb().collection('users').doc(me.uid).set({
    uid: me.uid, username: 'aliceme', usernameLower: 'aliceme',
    displayName: 'Me', displayNameLower: 'me',
  });
  const { users } = await search('ali', me);
  const uids = users.map((u) => u.uid);
  assert.ok(!uids.includes(me.uid), 'viewer must be excluded');
  assert.ok(uids.includes('u_alice'));
});

test('dedupes when a user matches BOTH username and displayName queries', async () => {
  await adminDb().collection('users').doc('u_alice').update({
    displayName: 'Alice S', displayNameLower: 'alice s',
  });
  const { users } = await search('alice');
  const aliceHits = users.filter((u) => u.uid === 'u_alice');
  assert.equal(aliceHits.length, 1);
});

test('2-character minimum: 1-char and empty queries return empty', async () => {
  assert.deepEqual((await search('a')).users, []);
  assert.deepEqual((await search('')).users, []);
});

test('no false positives — a user whose neither field starts with the query is excluded', async () => {
  const { users } = await search('alice');
  assert.ok(!users.map((u) => u.uid).includes('u_bob'));
});

test('legacy user without usernameLower/displayNameLower is NOT returned (needs backfill)', async () => {
  await adminDb().collection('users').doc('legacy').set({
    uid: 'legacy', username: 'AliceLegacy', displayName: 'Alice Legacy',
  });
  const { users } = await search('alice');
  assert.ok(!users.map((u) => u.uid).includes('legacy'));
});

test('email is never in the result (1.9 — public /users doc no longer has it)', async () => {
  const { users } = await search('alice');
  for (const u of users) assert.equal(u.email, '');
});

test('unauthenticated viewer still gets matches (route is public)', async () => {
  // Without a token: no self-exclusion (there is no "self"), no block filter.
  const { users } = await search('al');
  assert.ok(users.length >= 2);
});
