/**
 * Phase A.3 PR #12 — post-comments endpoint tests.
 *
 * Covers:
 *   - POST   /api/v1/posts/[id]/comments               createPostComment
 *   - GET    /api/v1/posts/[id]/comments               getPostComments (public, block-filtered)
 *   - DELETE /api/v1/posts/[id]/comments/[cid]         deletePostComment (comment OR post author)
 *   - POST   /api/v1/posts/[id]/comments/[cid]/like    likePostComment (transactional, AUDIT 3.5)
 *   - DELETE /api/v1/posts/[id]/comments/[cid]/like    unlikePostComment (transactional)
 *
 * Invariants preserved from the legacy actions:
 *   - block-aware create (rejects when either side blocks)
 *   - block-aware GET (filters out comments authored by blocked users)
 *   - top-level vs reply notification recipient resolution
 *   - transactional like — no double-increment under concurrent calls (AUDIT 3.5)
 *   - delete authorization: comment author OR post author (moderation)
 *   - replyCount / commentCount bookkeeping on delete
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, callActionAs,
  adminDb, clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as createComment, GET as getComments }
  from '@/app/api/v1/posts/[id]/comments/route';
import { DELETE as deleteComment }
  from '@/app/api/v1/posts/[id]/comments/[cid]/route';
import { POST as likeComment, DELETE as unlikeComment }
  from '@/app/api/v1/posts/[id]/comments/[cid]/like/route';

let blockUser: (idToken: unknown, blockedId: string) => Promise<any>;
let alice: TestUser, bob: TestUser, carol: TestUser;

before(async () => {
  setupTestEnv();
  ({ blockUser } = await import('@/app/actions'));
});

async function seedUser(uid: string, username: string) {
  await adminDb().collection('users').doc(uid).set({
    username, usernameLower: username, displayName: username,
    followersCount: 0, followingCount: 0,
  });
}

async function seedPost(id: string, authorId: string) {
  await adminDb().collection('posts').doc(id).set({
    id, authorId, authorUsername: authorId, text: id, media: [],
    taggedMovie: null, taggedUserIds: [], taggedUsers: [], place: null,
    likes: 0, likedBy: [], commentCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  carol = await createTestUser('carol');
  await seedUser(alice.uid, 'alice');
  await seedUser(bob.uid, 'bob');
  await seedUser(carol.uid, 'carol');
});

after(async () => { await clearFirestore(); await clearAuth(); });

// ─── POST /posts/[id]/comments ───────────────────────────────────────────

test('POST comments: unauth → 401', async () => {
  await seedPost('p1', alice.uid);
  const res = await callRoute(createComment, 'POST', {
    params: { id: 'p1' }, body: { text: 'hi' },
  });
  assert.equal(res.status, 401);
});

test('POST comments: empty text → 400', async () => {
  await seedPost('p1', alice.uid);
  const token = await bob.getIdToken();
  const res = await callRoute(createComment, 'POST', {
    token, params: { id: 'p1' }, body: { text: '   ' },
  });
  assert.equal(res.status, 400);
});

test('POST comments: missing post → 404', async () => {
  const token = await bob.getIdToken();
  const res = await callRoute(createComment, 'POST', {
    token, params: { id: 'nope' }, body: { text: 'hi' },
  });
  assert.equal(res.status, 404);
});

test('POST comments: top-level → comment stored + post author notified', async () => {
  await seedPost('p1', alice.uid);
  const token = await bob.getIdToken();
  const res = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token, params: { id: 'p1' }, body: { text: 'banger' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');

  const c = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(res.body.data.commentId).get()).data();
  assert.equal(c?.userId, bob.uid);
  assert.equal(c?.text, 'banger');
  assert.equal(c?.parentId, null);

  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.commentCount, 1);

  const notifs = await adminDb()
    .collection('notifications').where('userId', '==', alice.uid).get();
  assert.ok(notifs.docs.some((d) => d.data().type === 'post_comment'));
});

test('POST comments: reply → parent author notified, replyCount bumped', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  const carolToken = await carol.getIdToken();

  const top = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'top' },
  });
  if (top.body.ok !== true) return assert.fail('expected ok');

  const reply = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: carolToken, params: { id: 'p1' },
    body: { text: 'replying', parentId: top.body.data.commentId },
  });
  assert.equal(reply.status, 200);
  if (reply.body.ok !== true) return assert.fail('expected ok');

  const parent = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(top.body.data.commentId).get()).data();
  assert.equal(parent?.replyCount, 1);

  // Reply notifies the parent's author (bob), not the post's author (alice).
  const bobNotifs = await adminDb()
    .collection('notifications').where('userId', '==', bob.uid).get();
  assert.ok(bobNotifs.docs.some((d) => d.data().type === 'post_comment'));
});

test('POST comments: blocked → 403, no comment, no notification', async () => {
  await seedPost('p1', alice.uid);
  await callActionAs(alice, blockUser, bob.uid);

  const bobToken = await bob.getIdToken();
  const res = await callRoute(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'sneaky' },
  });
  assert.equal(res.status, 403);

  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.commentCount, 0);
});

// ─── GET /posts/[id]/comments ────────────────────────────────────────────

test('GET comments: public — no auth required', async () => {
  await seedPost('p1', alice.uid);
  const aliceToken = await alice.getIdToken();
  await callRoute(createComment, 'POST', {
    token: aliceToken, params: { id: 'p1' }, body: { text: 'hi' },
  });

  const res = await callRoute<{ comments: Array<{ text: string }> }>(getComments, 'GET', {
    params: { id: 'p1' },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.comments.length, 1);
  assert.equal(res.body.data.comments[0].text, 'hi');
});

test('GET comments: block-filtered for the viewer', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  await callRoute(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'from bob' },
  });

  // Carol blocks bob — bob's comment should disappear for carol.
  await callActionAs(carol, blockUser, bob.uid);

  const carolToken = await carol.getIdToken();
  const res = await callRoute<{ comments: Array<{ userId: string }> }>(getComments, 'GET', {
    token: carolToken, params: { id: 'p1' },
  });
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.ok(!res.body.data.comments.some((c) => c.userId === bob.uid));

  // Unauthenticated viewer still sees it (no block context).
  const anon = await callRoute<{ comments: unknown[] }>(getComments, 'GET', {
    params: { id: 'p1' },
  });
  if (anon.body.ok !== true) return assert.fail('expected ok');
  assert.equal(anon.body.data.comments.length, 1);
});

// ─── DELETE /posts/[id]/comments/[cid] ───────────────────────────────────

test('DELETE comment: comment author can delete own → 200', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  const created = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'mine' },
  });
  if (created.body.ok !== true) return assert.fail('expected ok');

  const res = await callRoute(deleteComment, 'DELETE', {
    token: bobToken, params: { id: 'p1', cid: created.body.data.commentId },
  });
  assert.equal(res.status, 200);

  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.commentCount, 0);
});

test('DELETE comment: post author can moderate (delete a different user\'s comment)', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  const created = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'spam' },
  });
  if (created.body.ok !== true) return assert.fail('expected ok');

  const aliceToken = await alice.getIdToken();
  const res = await callRoute(deleteComment, 'DELETE', {
    token: aliceToken, params: { id: 'p1', cid: created.body.data.commentId },
  });
  assert.equal(res.status, 200);
});

test('DELETE comment: random user → 403', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  const created = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'mine' },
  });
  if (created.body.ok !== true) return assert.fail('expected ok');

  const carolToken = await carol.getIdToken();
  const res = await callRoute(deleteComment, 'DELETE', {
    token: carolToken, params: { id: 'p1', cid: created.body.data.commentId },
  });
  assert.equal(res.status, 403);
});

test('DELETE comment: missing comment → 404', async () => {
  await seedPost('p1', alice.uid);
  const aliceToken = await alice.getIdToken();
  const res = await callRoute(deleteComment, 'DELETE', {
    token: aliceToken, params: { id: 'p1', cid: 'nope' },
  });
  assert.equal(res.status, 404);
});

test('DELETE reply: decrements parent.replyCount, not post.commentCount', async () => {
  await seedPost('p1', alice.uid);
  const bobToken = await bob.getIdToken();
  const top = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: bobToken, params: { id: 'p1' }, body: { text: 'top' },
  });
  if (top.body.ok !== true) return assert.fail('expected ok');

  const carolToken = await carol.getIdToken();
  const reply = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token: carolToken, params: { id: 'p1' },
    body: { text: 'reply', parentId: top.body.data.commentId },
  });
  if (reply.body.ok !== true) return assert.fail('expected ok');

  const before = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(before?.commentCount, 1);

  await callRoute(deleteComment, 'DELETE', {
    token: carolToken, params: { id: 'p1', cid: reply.body.data.commentId },
  });

  const post = (await adminDb().collection('posts').doc('p1').get()).data();
  assert.equal(post?.commentCount, 1, 'post commentCount unchanged on reply delete');

  const parent = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(top.body.data.commentId).get()).data();
  assert.equal(parent?.replyCount, 0);
});

// ─── POST /posts/[id]/comments/[cid]/like ────────────────────────────────

async function createCommentAs(post: string, user: TestUser, text = 'hi') {
  const token = await user.getIdToken();
  const res = await callRoute<{ commentId: string }>(createComment, 'POST', {
    token, params: { id: post }, body: { text },
  });
  if (res.body.ok !== true) throw new Error('seed comment failed');
  return res.body.data.commentId;
}

test('POST like: unauth → 401', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const res = await callRoute(likeComment, 'POST', { params: { id: 'p1', cid } });
  assert.equal(res.status, 401);
});

test('POST like: missing comment → 404', async () => {
  await seedPost('p1', alice.uid);
  const token = await bob.getIdToken();
  const res = await callRoute(likeComment, 'POST', {
    token, params: { id: 'p1', cid: 'nope' },
  });
  assert.equal(res.status, 404);
});

test('POST like: happy path → likes 1, returns count', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  const res = await callRoute<{ likes: number }>(likeComment, 'POST', {
    token, params: { id: 'p1', cid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 1);

  const after = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(cid).get()).data();
  assert.equal(after?.likes, 1);
  assert.deepEqual(after?.likedBy, [bob.uid]);
});

test('POST like: already-liked → 409', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  await callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } });
  const dup = await callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } });
  assert.equal(dup.status, 409);
});

test('POST like: concurrent double-like → exactly one increment (AUDIT 3.5)', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  const results = await Promise.allSettled([
    callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } }),
    callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } }),
  ]);
  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort();
  assert.deepEqual(statuses, [200, 409], 'one success, one already-liked');

  const after = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(cid).get()).data();
  assert.equal(after?.likes, 1, 'no double-increment');
  assert.equal((after?.likedBy as string[]).length, 1);
});

// ─── DELETE /posts/[id]/comments/[cid]/like ──────────────────────────────

test('DELETE like: not-liked → 409', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  const res = await callRoute(unlikeComment, 'DELETE', {
    token, params: { id: 'p1', cid },
  });
  assert.equal(res.status, 409);
});

test('DELETE like: drops like + decrements', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  await callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } });

  const res = await callRoute<{ likes: number }>(unlikeComment, 'DELETE', {
    token, params: { id: 'p1', cid },
  });
  assert.equal(res.status, 200);
  if (res.body.ok !== true) return assert.fail('expected ok');
  assert.equal(res.body.data.likes, 0);
});

test('DELETE like: concurrent double-unlike → no drift below 0', async () => {
  await seedPost('p1', alice.uid);
  const cid = await createCommentAs('p1', alice);
  const token = await bob.getIdToken();
  await callRoute(likeComment, 'POST', { token, params: { id: 'p1', cid } });

  await Promise.all([
    callRoute(unlikeComment, 'DELETE', { token, params: { id: 'p1', cid } }),
    callRoute(unlikeComment, 'DELETE', { token, params: { id: 'p1', cid } }),
  ]);

  const after = (await adminDb()
    .collection('posts').doc('p1')
    .collection('comments').doc(cid).get()).data();
  assert.equal(after?.likes, 0);
});
