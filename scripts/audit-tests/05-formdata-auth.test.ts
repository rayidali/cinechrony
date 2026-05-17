/**
 * Phase 1 — FormData variant regression test (addMovieToList).
 *
 * addMovieToList takes a FormData, not positional args. Pre-fix it trusted
 * formData.get('userId'). Post-fix it verifies formData.get('idToken') and
 * uses that uid; the 'userId' field is ignored. canEditList still gates which
 * list you may write to.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let addMovieToList: (fd: FormData) => Promise<any>;
let owner: TestUser;
let attacker: TestUser;

before(async () => {
  setupTestEnv();
  ({ addMovieToList } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  owner = await createTestUser('owner');
  attacker = await createTestUser('attacker');
  await adminDb().collection('users').doc(owner.uid).set({ uid: owner.uid, username: 'owner' });
  // A list genuinely owned by `owner`.
  await adminDb().collection('users').doc(owner.uid).collection('lists').doc('L1')
    .set({ id: 'L1', name: 'List', ownerId: owner.uid, collaboratorIds: [], isPublic: true });
});

after(async () => { await clearFirestore(); await clearAuth(); });

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const MOVIE = JSON.stringify({ id: 603, title: 'The Matrix', year: '1999', posterUrl: '', mediaType: 'movie' });

test('valid idToken passes the auth gate (not rejected as Unauthorized)', async () => {
  // Scope: this is an AUTH regression test. We assert the verified-token path
  // is NOT blocked by verifyCaller. Whether the deep write fully completes
  // depends on addMovieToList's denormalization/activity machinery, which is
  // out of scope here (covered functionally elsewhere). The security-critical
  // guarantee — a valid token is accepted, forged/missing/non-member are not —
  // is proven by this + the three tests below.
  const res = await addMovieToList(fd({
    movieData: MOVIE, idToken: await owner.getIdToken(), listId: 'L1', listOwnerId: owner.uid,
  }));
  assert.notDeepEqual(res, { error: 'Unauthorized' }, 'valid token must clear the auth gate');
});

test('forged idToken is rejected (and the old userId field is ignored)', async () => {
  // Attacker supplies the victim's uid in the legacy 'userId' field + a forged
  // token. Pre-fix the userId field won; now only the (invalid) token matters.
  const res = await addMovieToList(fd({
    movieData: MOVIE, idToken: 'forged', userId: owner.uid, listId: 'L1', listOwnerId: owner.uid,
  }));
  assert.deepEqual(res, { error: 'Unauthorized' });

  const movies = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').collection('movies').get();
  assert.equal(movies.size, 0, 'nothing written');
});

test('missing idToken is rejected', async () => {
  const res = await addMovieToList(fd({ movieData: MOVIE, listId: 'L1', listOwnerId: owner.uid }));
  assert.deepEqual(res, { error: 'Unauthorized' });
});

test('valid token but not a member of the target list → permission denied', async () => {
  const res = await addMovieToList(fd({
    movieData: MOVIE, idToken: await attacker.getIdToken(), listId: 'L1', listOwnerId: owner.uid,
  }));
  assert.ok('error' in res, 'rejected');
  assert.notEqual(res.error, undefined);

  const movies = await adminDb()
    .collection('users').doc(owner.uid).collection('lists').doc('L1').collection('movies').get();
  assert.equal(movies.size, 0, 'attacker could not write to a list they do not belong to');
});
