/**
 * Phase 2.8 — searchUsers: per-keystroke full-scan → prefix-range queries.
 *
 * Pre-fix: db.collection('users').get() on every keystroke (~5MB at 5k users
 * per character typed). Now: two parallel single-field prefix-range queries
 * on usernameLower / displayNameLower, each limited. O(matches), not O(N).
 *
 * Asserts the post-fix correctness contract:
 *  - prefix on usernameLower finds the user
 *  - prefix on displayNameLower finds the user (different field)
 *  - excludes currentUserId
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

let searchUsers: (query: string, currentUserId?: string) => Promise<any>;
let me: TestUser;

before(async () => {
  setupTestEnv();
  ({ searchUsers } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  me = await createTestUser('me');

  // Seed users with explicit normalized fields (mirrors what the Phase 1
  // creators write at signup).
  const seed = async (uid: string, username: string, displayName: string) => {
    await adminDb().collection('users').doc(uid).set({
      uid, username, usernameLower: username.toLowerCase(),
      displayName, displayNameLower: displayName.toLowerCase(),
    });
  };
  await seed('u_alice', 'alicehandle', 'Alice Smith');
  await seed('u_alex', 'alexcat', 'Alex Park');           // shares 'al' prefix with alice
  await seed('u_bob', 'bobby', 'Bob Jones');               // shouldn't match 'al'
  await seed('u_zoe', 'zoenobody', 'Zoe Alice Lane');     // displayName starts with Zoe; contains 'Alice'
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('prefix on usernameLower returns starts-with matches only', async () => {
  const res = await searchUsers('al');
  const uids = res.users.map((u: any) => u.uid).sort();
  // alicehandle, alexcat → both start with 'al'. zoenobody doesn't.
  assert.deepEqual(uids, ['u_alex', 'u_alice'].sort(), `unexpected: ${JSON.stringify(uids)}`);
  assert.equal(res.users.find((u: any) => u.uid === 'u_bob'), undefined, 'bob excluded');
});

test('prefix on displayNameLower picks up matches not in username', async () => {
  // 'zoe' is a displayName prefix; no usernameLower starts with 'zoe'.
  const res = await searchUsers('zoe');
  const uids = res.users.map((u: any) => u.uid);
  assert.ok(uids.includes('u_zoe'), `zoe should appear; got ${JSON.stringify(uids)}`);
});

test('currentUserId is filtered out of results', async () => {
  await adminDb().collection('users').doc(me.uid).set({
    uid: me.uid, username: 'aliceme', usernameLower: 'aliceme',
    displayName: 'Me', displayNameLower: 'me',
  });
  const res = await searchUsers('ali', me.uid);
  const uids = res.users.map((u: any) => u.uid);
  assert.ok(!uids.includes(me.uid), `current user must be excluded; got ${JSON.stringify(uids)}`);
  assert.ok(uids.includes('u_alice'), 'others still appear');
});

test('dedupes when a user matches BOTH username and displayName queries', async () => {
  // 'alice' matches u_alice.usernameLower (alicehandle starts with 'alice') AND
  // u_zoe.displayNameLower contains... wait, displayNameLower is "zoe alice lane",
  // and the query is a prefix on displayNameLower → starts-with 'alice' is false
  // for that field (it starts with 'zoe'). So no double-match there.
  // Set u_alice's displayNameLower to also start with 'alice' to force the
  // double-match condition.
  await adminDb().collection('users').doc('u_alice').update({ displayName: 'Alice S', displayNameLower: 'alice s' });
  const res = await searchUsers('alice');
  const aliceHits = res.users.filter((u: any) => u.uid === 'u_alice');
  assert.equal(aliceHits.length, 1, 'u_alice appears exactly once despite matching both fields');
});

test('2-character minimum: 1-char and empty queries return empty', async () => {
  assert.deepEqual((await searchUsers('a')).users, []);
  assert.deepEqual((await searchUsers('')).users, []);
});

test('no false positives — a user whose neither field starts with the query is excluded', async () => {
  const res = await searchUsers('alice');
  const uids = res.users.map((u: any) => u.uid);
  assert.ok(!uids.includes('u_bob'), 'bob (no "alice" prefix in either field) excluded');
});

test('legacy user without usernameLower/displayNameLower is NOT returned (needs backfill)', async () => {
  // Seed a legacy doc with no normalized fields.
  await adminDb().collection('users').doc('legacy').set({
    uid: 'legacy', username: 'AliceLegacy', displayName: 'Alice Legacy',
  });
  const res = await searchUsers('alice');
  const uids = res.users.map((u: any) => u.uid);
  assert.ok(!uids.includes('legacy'), 'legacy user surfaces only after backfillUserSearchFields runs');
});

test('email is never in the result (1.9 — public /users doc no longer has it)', async () => {
  const res = await searchUsers('alice');
  for (const u of res.users) {
    assert.equal(u.email, '', `expected empty email on every result, got: ${u.email}`);
  }
});
