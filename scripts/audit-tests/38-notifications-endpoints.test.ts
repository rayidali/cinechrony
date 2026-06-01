/**
 * Phase A.3 PR #13 — notifications + push + preferences endpoint tests.
 *
 * Covers:
 *   - GET    /api/v1/notifications?cursor=&limit=     listNotifications
 *   - GET    /api/v1/notifications/unread-count       getUnreadNotificationCount
 *   - POST   /api/v1/notifications/read               markNotificationsRead
 *   - POST   /api/v1/me/push-subscription             savePushSubscription (rate-limited)
 *   - DELETE /api/v1/me/push-subscription             removePushSubscription
 *   - GET    /api/v1/me/push-status                   getPushStatus
 *   - GET    /api/v1/me/notification-preferences      getNotificationPreferences
 *   - PATCH  /api/v1/me/notification-preferences      updateNotificationPreferences
 *
 * Invariants preserved + new guarantees this migration introduces:
 *   - identity always comes from the verified Bearer token; the legacy
 *     `userId` arg surface is gone — no client can ever fetch another
 *     user's notifications, count, push state, or preferences
 *   - markNotificationsRead with a list of IDs only updates docs OWNED
 *     by the caller (per-doc ownership check)
 *   - block-aware list (legacy behavior carried over)
 *   - cursor pagination matching the activities pattern
 *   - push subscription validation (https endpoint, key shape)
 *   - pushEnabled flips on first subscribe and off on last unsubscribe
 *   - preference PATCH ignores unknown keys, merges sanitized booleans
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { GET as listGet }                from '@/app/api/v1/notifications/route';
import { GET as unreadGet }              from '@/app/api/v1/notifications/unread-count/route';
import { POST as readPost }              from '@/app/api/v1/notifications/read/route';
import { POST as pushPost, DELETE as pushDelete }
  from '@/app/api/v1/me/push-subscription/route';
import { GET as pushStatusGet }          from '@/app/api/v1/me/push-status/route';
import { GET as prefsGet, PATCH as prefsPatch }
  from '@/app/api/v1/me/notification-preferences/route';

let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser;

before(async () => {
  setupTestEnv();
  ({ blockUser } = await import('@/app/actions'));
});

async function seedNotification(
  id: string,
  recipient: string,
  opts: { from?: string; read?: boolean; createdAt?: Date; type?: string } = {},
) {
  await adminDb().collection('notifications').doc(id).set({
    userId: recipient,
    type: opts.type ?? 'mention',
    fromUserId: opts.from ?? bob.uid,
    fromUsername: 'bob',
    fromDisplayName: 'Bob',
    fromPhotoUrl: null,
    read: opts.read ?? false,
    previewText: id,
    createdAt: opts.createdAt ?? new Date(),
  });
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
});

after(async () => { await clearFirestore(); await clearAuth(); });

// ─── GET /notifications ──────────────────────────────────────────────────

test('GET /notifications: unauth → 401', async () => {
  const res = await callRoute(listGet, 'GET', {});
  assert.equal(res.status, 401);
});

test('GET /notifications: returns ONLY the caller\'s notifications', async () => {
  await seedNotification('n-alice', alice.uid);
  await seedNotification('n-bob', bob.uid);

  const token = await alice.getIdToken();
  const res = await callRoute<{ notifications: Array<{ id: string }> }>(
    listGet, 'GET', { token },
  );
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  const ids = res.body.data.notifications.map((n) => n.id);
  assert.deepEqual(ids, ['n-alice'], "alice can't see bob's notifications");
});

test('GET /notifications: block-filtered (sender blocked)', async () => {
  await seedNotification('n-from-bob', alice.uid, { from: bob.uid });
  await seedNotification('n-from-carol', alice.uid, { from: carol.uid });
  await callActionAs(alice, blockUser, bob.uid);

  const token = await alice.getIdToken();
  const res = await callRoute<{ notifications: Array<{ id: string; fromUserId: string }> }>(
    listGet, 'GET', { token },
  );
  if (res.body.ok !== true) return assert.fail('expected ok');
  const senders = res.body.data.notifications.map((n) => n.fromUserId);
  assert.ok(!senders.includes(bob.uid), 'blocked bob filtered out');
  assert.ok(senders.includes(carol.uid));
});

test('GET /notifications: cursor pagination — 3 over 5 with limit=2', async () => {
  for (let i = 0; i < 5; i++) {
    await seedNotification(`n${i}`, alice.uid, { createdAt: new Date(2024, 0, i + 1) });
  }
  const token = await alice.getIdToken();

  const page1 = await callRoute<{ notifications: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    listGet, 'GET',
    { token, url: 'http://test/api/v1/notifications?limit=2' },
  );
  if (page1.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page1.body.data.notifications.length, 2);
  assert.equal(page1.body.data.hasMore, true);

  const page2 = await callRoute<{ notifications: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>(
    listGet, 'GET',
    { token, url: `http://test/api/v1/notifications?limit=2&cursor=${page1.body.data.nextCursor}` },
  );
  if (page2.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page2.body.data.notifications.length, 2);
  assert.equal(page2.body.data.hasMore, true);

  const page3 = await callRoute<{ notifications: Array<{ id: string }>; hasMore: boolean }>(
    listGet, 'GET',
    { token, url: `http://test/api/v1/notifications?limit=2&cursor=${page2.body.data.nextCursor}` },
  );
  if (page3.body.ok !== true) return assert.fail('expected ok');
  assert.equal(page3.body.data.notifications.length, 1);
  assert.equal(page3.body.data.hasMore, false);
});

// ─── GET /notifications/unread-count ─────────────────────────────────────

test('GET /unread-count: counts only the caller\'s unread (security gap closed)', async () => {
  await seedNotification('a1', alice.uid, { read: false });
  await seedNotification('a2', alice.uid, { read: true });
  await seedNotification('b1', bob.uid, { read: false });

  const token = await alice.getIdToken();
  const res = await callRoute<{ count: number }>(unreadGet, 'GET', { token });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.count, 1, 'alice has 1 unread (not 2, not 3)');
});

test('GET /unread-count: unauth → 401', async () => {
  const res = await callRoute(unreadGet, 'GET', {});
  assert.equal(res.status, 401);
});

// ─── POST /notifications/read ────────────────────────────────────────────

test('POST /notifications/read: no body marks ALL caller\'s unread as read', async () => {
  await seedNotification('a1', alice.uid, { read: false });
  await seedNotification('a2', alice.uid, { read: false });
  await seedNotification('b1', bob.uid, { read: false });
  const token = await alice.getIdToken();

  const res = await callRoute(readPost, 'POST', { token });
  assert.equal(res.status, 200);

  const a1 = (await adminDb().collection('notifications').doc('a1').get()).data();
  const a2 = (await adminDb().collection('notifications').doc('a2').get()).data();
  const b1 = (await adminDb().collection('notifications').doc('b1').get()).data();
  assert.equal(a1?.read, true);
  assert.equal(a2?.read, true);
  assert.equal(b1?.read, false, "bob's notification untouched");
});

test('POST /notifications/read: with ids only flips the caller\'s docs', async () => {
  await seedNotification('a1', alice.uid, { read: false });
  await seedNotification('b1', bob.uid, { read: false });

  const token = await alice.getIdToken();
  const res = await callRoute(readPost, 'POST', {
    token, body: { ids: ['a1', 'b1'] },
  });
  assert.equal(res.status, 200);

  const a1 = (await adminDb().collection('notifications').doc('a1').get()).data();
  const b1 = (await adminDb().collection('notifications').doc('b1').get()).data();
  assert.equal(a1?.read, true);
  assert.equal(b1?.read, false, "bob's doc unchanged (per-doc ownership check)");
});

test('POST /notifications/read: bad ids type → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(readPost, 'POST', {
    token, body: { ids: 'not-an-array' },
  });
  assert.equal(res.status, 400);
});

// ─── POST/DELETE /me/push-subscription ───────────────────────────────────

const goodSub = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'k1', auth: 'k2' },
};

test('POST /me/push-subscription: unauth → 401', async () => {
  const res = await callRoute(pushPost, 'POST', { body: goodSub });
  assert.equal(res.status, 401);
});

test('POST /me/push-subscription: bad endpoint (non-https) → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(pushPost, 'POST', {
    token, body: { ...goodSub, endpoint: 'http://insecure.example.com/abc' },
  });
  assert.equal(res.status, 400);
});

test('POST /me/push-subscription: bad keys shape → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(pushPost, 'POST', {
    token, body: { endpoint: goodSub.endpoint, keys: { p256dh: 'k1' } },
  });
  assert.equal(res.status, 400);
});

test('POST /me/push-subscription: happy path → pushEnabled=true, sub stored', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(pushPost, 'POST', { token, body: goodSub });
  assert.equal(res.status, 200);

  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.pushEnabled, true);

  const subs = await adminDb()
    .collection('users').doc(alice.uid).collection('pushSubscriptions').get();
  assert.equal(subs.size, 1);
  assert.equal(subs.docs[0].data().endpoint, goodSub.endpoint);
});

test('POST /me/push-subscription: idempotent on same endpoint', async () => {
  const token = await alice.getIdToken();
  await callRoute(pushPost, 'POST', { token, body: goodSub });
  await callRoute(pushPost, 'POST', { token, body: goodSub });
  const subs = await adminDb()
    .collection('users').doc(alice.uid).collection('pushSubscriptions').get();
  assert.equal(subs.size, 1, 'second subscribe to same endpoint did not duplicate');
});

test('DELETE /me/push-subscription: removes + flips pushEnabled when last', async () => {
  const token = await alice.getIdToken();
  await callRoute(pushPost, 'POST', { token, body: goodSub });

  const del = await callRoute(pushDelete, 'DELETE', {
    token, body: { endpoint: goodSub.endpoint },
  });
  assert.equal(del.status, 200);

  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.pushEnabled, false, 'no subscriptions left → pushEnabled false');
});

test('DELETE /me/push-subscription: keeps pushEnabled true if other subs remain', async () => {
  const token = await alice.getIdToken();
  await callRoute(pushPost, 'POST', { token, body: goodSub });
  await callRoute(pushPost, 'POST', {
    token,
    body: { endpoint: 'https://push.example.com/two', keys: { p256dh: 'k3', auth: 'k4' } },
  });

  await callRoute(pushDelete, 'DELETE', {
    token, body: { endpoint: goodSub.endpoint },
  });

  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.pushEnabled, true, 'second sub still active');
});

// ─── GET /me/push-status ─────────────────────────────────────────────────

test('GET /me/push-status: reads caller\'s pushEnabled, ignores anyone else\'s', async () => {
  // alice has push; bob doesn't.
  await adminDb().collection('users').doc(alice.uid).set({ pushEnabled: true });
  await adminDb().collection('users').doc(bob.uid).set({ pushEnabled: false });

  const aliceRes = await callRoute<{ enabled: boolean }>(pushStatusGet, 'GET', {
    token: await alice.getIdToken(),
  });
  if (aliceRes.body.ok !== true) return assert.fail('expected ok');
  assert.equal(aliceRes.body.data.enabled, true);

  const bobRes = await callRoute<{ enabled: boolean }>(pushStatusGet, 'GET', {
    token: await bob.getIdToken(),
  });
  if (bobRes.body.ok !== true) return assert.fail('expected ok');
  assert.equal(bobRes.body.data.enabled, false);
});

// ─── GET/PATCH /me/notification-preferences ──────────────────────────────

test('GET /me/notification-preferences: returns defaults when unset', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute<{ preferences: Record<string, boolean> }>(
    prefsGet, 'GET', { token },
  );
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.preferences.mentions, true);
  assert.equal(res.body.data.preferences.weeklyDigest, true);
});

test('PATCH /me/notification-preferences: merges partial; unknown keys dropped', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(prefsPatch, 'PATCH', {
    token,
    body: { mentions: false, evil: true, weeklyDigest: false },
  });
  assert.equal(res.status, 200);

  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.notificationPreferences?.mentions, false);
  assert.equal(userDoc?.notificationPreferences?.weeklyDigest, false);
  assert.equal(userDoc?.notificationPreferences?.evil, undefined, 'unknown key dropped');
});

test('PATCH /me/notification-preferences: second PATCH merges, does not wipe prior keys', async () => {
  const token = await alice.getIdToken();
  await callRoute(prefsPatch, 'PATCH', { token, body: { mentions: false } });
  await callRoute(prefsPatch, 'PATCH', { token, body: { replies: false } });

  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.notificationPreferences?.mentions, false);
  assert.equal(userDoc?.notificationPreferences?.replies, false);
});

test('PATCH /me/notification-preferences: non-boolean values silently ignored', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(prefsPatch, 'PATCH', {
    token, body: { mentions: 'yes please' },
  });
  // The PATCH succeeds but writes nothing because no booleans came through.
  assert.equal(res.status, 200);
  const userDoc = (await adminDb().collection('users').doc(alice.uid).get()).data();
  assert.equal(userDoc?.notificationPreferences?.mentions, undefined);
});

test('PATCH /me/notification-preferences: unauth → 401', async () => {
  const res = await callRoute(prefsPatch, 'PATCH', { body: { mentions: false } });
  assert.equal(res.status, 401);
});
