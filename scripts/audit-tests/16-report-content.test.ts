/**
 * App Store §1.2 (UGC) — content reporting.
 *
 * Apple rejects social apps that lack a way to report objectionable
 * user-generated content. reportContent writes to the server-only /reports
 * collection for the developer to review.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs, callActionWithRawToken,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';

let reportContent: (idToken: unknown, type: string, targetId: string, reason: string) => Promise<any>;
let alice: TestUser;

before(async () => {
  setupTestEnv();
  ({ reportContent } = await import('@/app/actions'));
});

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
});

after(async () => { await clearFirestore(); await clearAuth(); });

test('a signed-in user can report a review; it lands in /reports', async () => {
  const res = await callActionAs(alice, reportContent, 'review', 'r1', 'spam');
  assert.ok(!('error' in res), JSON.stringify(res));

  const reports = await adminDb().collection('reports').get();
  assert.equal(reports.size, 1);
  const r = reports.docs[0].data();
  assert.equal(r.reporterId, alice.uid);
  assert.equal(r.contentType, 'review');
  assert.equal(r.targetId, 'r1');
  assert.equal(r.reason, 'spam');
  assert.equal(r.status, 'pending', 'starts pending for moderator review');
});

test('forged token cannot file a report', async () => {
  const res = await callActionWithRawToken('forged', reportContent, 'review', 'r1', 'x');
  assert.deepEqual(res, { error: 'Unauthorized' });
  assert.equal((await adminDb().collection('reports').get()).size, 0);
});

test('invalid content type is rejected', async () => {
  const res = await callActionAs(alice, reportContent, 'banana', 'x', 'y');
  assert.deepEqual(res, { error: 'Invalid report.' });
});

test('report spam is rate-limited (10/min)', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await callActionAs(alice, reportContent, 'user', `u${i}`, 'harassment');
    assert.ok(!('error' in r), `report ${i} should succeed`);
  }
  const over = await callActionAs(alice, reportContent, 'user', 'u11', 'harassment');
  assert.ok('error' in over, '11th report in the window is rate-limited');
});
