/**
 * Phase 0.7 Wave 3 (F04) — post visibility, watch-log, and close-friends.
 *
 * Covers:
 *   - createPost writes watchType / watchedOn / visibility (+ clamps future dates)
 *   - createPost records a /users/{uid}/watches entry for the tagged film
 *   - audience enforcement in getPost + getHomeFeed:
 *       only_me   → author only
 *       friends   → author's mutuals (follow-back)
 *       close_friends → author's curated inner circle
 *       everyone  → all (incl. anonymous)
 *   - GET/PUT /api/v1/me/close-friends round-trip
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTestEnv, createTestUser, adminDb,
  clearFirestore, clearAuth, type TestUser,
} from './harness.ts';
import { callRoute } from './lib/route-call.ts';

import { POST as createPost } from '@/app/api/v1/posts/route';
import { GET as getPost } from '@/app/api/v1/posts/[id]/route';
import { GET as homeFeed } from '@/app/api/v1/home-feed/route';
import { GET as getCloseFriends, PUT as putCloseFriends } from '@/app/api/v1/me/close-friends/route';
import { POST as createComment, GET as getComments } from '@/app/api/v1/posts/[id]/comments/route';
import { POST as likePost } from '@/app/api/v1/posts/[id]/like/route';

let alice: TestUser, bob: TestUser;

before(() => { setupTestEnv(); });

beforeEach(async () => {
  await clearFirestore();
  alice = await createTestUser('alice');
  bob = await createTestUser('bob');
  await adminDb().collection('users').doc(alice.uid).set({ uid: alice.uid, username: 'alice', usernameLower: 'alice' });
  await adminDb().collection('users').doc(bob.uid).set({ uid: bob.uid, username: 'bob', usernameLower: 'bob' });
});

after(async () => { await clearFirestore(); await clearAuth(); });

const postDoc = (id: string) => adminDb().collection('posts').doc(id);
const sampleTaggedMovie = {
  tmdbId: 603, mediaType: 'movie' as const, title: 'The Matrix',
  posterUrl: 'http://example/p.jpg', year: '1999',
};

async function makePost(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await callRoute<{ postId: string }>(createPost, 'POST', {
    token, body: { taggedMovie: sampleTaggedMovie, ...body },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  if (res.body.ok !== true) throw new Error('expected ok');
  return res.body.data.postId;
}

// Make `a` and `b` mutuals (each follows the other) by writing the symmetric
// follow edges directly — getMutualIds reads a's following ∩ a's followers.
async function makeMutuals(a: TestUser, b: TestUser) {
  await adminDb().collection('users').doc(a.uid).collection('following').doc(b.uid).set({ id: b.uid });
  await adminDb().collection('users').doc(a.uid).collection('followers').doc(b.uid).set({ id: b.uid });
  await adminDb().collection('users').doc(b.uid).collection('following').doc(a.uid).set({ id: a.uid });
  await adminDb().collection('users').doc(b.uid).collection('followers').doc(a.uid).set({ id: a.uid });
}

// ─── new post fields ──────────────────────────────────────────────────────

test('createPost: persists watchType + watchedOn + visibility', async () => {
  const token = await alice.getIdToken();
  const id = await makePost(token, {
    text: 'rewatch', rating: 8, watchType: 'rewatch',
    watchedOn: '2025-01-15T00:00:00.000Z', visibility: 'everyone',
  });
  const d = (await postDoc(id).get()).data();
  assert.equal(d?.watchType, 'rewatch');
  assert.equal(d?.visibility, 'everyone');
  assert.ok(d?.watchedOn, 'watchedOn stored');
  assert.equal(d?.watchedOn.toDate().getUTCFullYear(), 2025);
});

test('createPost: future watchedOn is clamped to ~now', async () => {
  const token = await alice.getIdToken();
  const future = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
  const id = await makePost(token, { text: 'x', watchedOn: future });
  const d = (await postDoc(id).get()).data();
  assert.ok(d?.watchedOn.toDate().getTime() <= Date.now() + 2000, 'future clamped');
});

test('createPost: records a watch-log entry for the tagged film', async () => {
  const token = await alice.getIdToken();
  await makePost(token, { text: 'logged it', rating: 7 });
  const watches = await adminDb()
    .collection('users').doc(alice.uid).collection('watches')
    .where('tmdbId', '==', 603).get();
  assert.equal(watches.size, 1, 'one watch recorded');
  assert.equal(watches.docs[0].data().rating, 7);
  // The post body must NOT become a separate /reviews doc (post is the take).
  const reviews = await adminDb().collection('reviews')
    .where('userId', '==', alice.uid).where('tmdbId', '==', 603).get();
  assert.equal(reviews.size, 0, 'no duplicate review created from the post');
});

// ─── visibility enforcement ─────────────────────────────────────────────────

test('only_me: author sees it, others + anonymous do not', async () => {
  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'private log', visibility: 'only_me' });

  const mine = await callRoute<{ post: unknown }>(getPost, 'GET', { token: aToken, params: { id } });
  if (mine.body.ok !== true) return assert.fail('ok');
  assert.ok(mine.body.data.post, 'author sees own only_me post');

  const bToken = await bob.getIdToken();
  const theirs = await callRoute<{ post: unknown }>(getPost, 'GET', { token: bToken, params: { id } });
  if (theirs.body.ok !== true) return assert.fail('ok');
  assert.equal(theirs.body.data.post, null, 'other user blocked');

  const anon = await callRoute<{ post: unknown }>(getPost, 'GET', { params: { id } });
  if (anon.body.ok !== true) return assert.fail('ok');
  assert.equal(anon.body.data.post, null, 'anonymous blocked');
});

test('friends: a mutual sees it; a non-mutual does not', async () => {
  const carol = await createTestUser('carol');
  await adminDb().collection('users').doc(carol.uid).set({ uid: carol.uid, username: 'carol', usernameLower: 'carol' });
  await makeMutuals(alice, bob); // bob is alice's mutual; carol is not

  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'for the inner ring', visibility: 'friends' });

  // The audience snapshot was computed at write time.
  const snap = (await postDoc(id).get()).data();
  assert.deepEqual(snap?.audienceUids, [bob.uid], 'audience snapshot = mutuals');

  const bRes = await callRoute<{ post: unknown }>(getPost, 'GET', { token: await bob.getIdToken(), params: { id } });
  if (bRes.body.ok !== true) return assert.fail('ok');
  assert.ok(bRes.body.data.post, 'mutual sees friends post');

  const cRes = await callRoute<{ post: unknown }>(getPost, 'GET', { token: await carol.getIdToken(), params: { id } });
  if (cRes.body.ok !== true) return assert.fail('ok');
  assert.equal(cRes.body.data.post, null, 'non-mutual blocked');
});

test('close_friends: a member sees it; a non-member does not', async () => {
  const carol = await createTestUser('carol');
  await adminDb().collection('users').doc(carol.uid).set({ uid: carol.uid, username: 'carol', usernameLower: 'carol' });
  await adminDb().collection('closeFriends').doc(alice.uid).set({ uid: alice.uid, ids: [bob.uid] });

  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'inner circle', visibility: 'close_friends' });

  const bRes = await callRoute<{ post: unknown }>(getPost, 'GET', { token: await bob.getIdToken(), params: { id } });
  if (bRes.body.ok !== true) return assert.fail('ok');
  assert.ok(bRes.body.data.post, 'close friend sees it');

  const cRes = await callRoute<{ post: unknown }>(getPost, 'GET', { token: await carol.getIdToken(), params: { id } });
  if (cRes.body.ok !== true) return assert.fail('ok');
  assert.equal(cRes.body.data.post, null, 'non-member blocked');
});

test('home-feed: a restricted post is hidden from outsiders but shown to the author', async () => {
  const aToken = await alice.getIdToken();
  await makePost(aToken, { text: 'public one', visibility: 'everyone' });
  await makePost(aToken, { text: 'just me', visibility: 'only_me' });

  const bobFeed = await callRoute<{ items: unknown[] }>(homeFeed, 'GET', { token: await bob.getIdToken() });
  if (bobFeed.body.ok !== true) return assert.fail('ok');
  assert.equal(bobFeed.body.data.items.length, 1, 'outsider sees only the public post');

  const aliceFeed = await callRoute<{ items: unknown[] }>(homeFeed, 'GET', { token: aToken });
  if (aliceFeed.body.ok !== true) return assert.fail('ok');
  assert.equal(aliceFeed.body.data.items.length, 2, 'author sees both');
});

// ─── close-friends endpoint ─────────────────────────────────────────────────

test('GET /me/close-friends: empty by default; PUT replaces + GET reflects', async () => {
  const token = await alice.getIdToken();
  const empty = await callRoute<{ ids: string[] }>(getCloseFriends, 'GET', { token });
  if (empty.body.ok !== true) return assert.fail('ok');
  assert.deepEqual(empty.body.data.ids, []);

  const put = await callRoute<{ ids: string[] }>(putCloseFriends, 'PUT', {
    token, body: { ids: [bob.uid, bob.uid, alice.uid] }, // dupes + self stripped
  });
  if (put.body.ok !== true) return assert.fail('ok');
  assert.deepEqual(put.body.data.ids, [bob.uid]);

  const after = await callRoute<{ ids: string[] }>(getCloseFriends, 'GET', { token });
  if (after.body.ok !== true) return assert.fail('ok');
  assert.deepEqual(after.body.data.ids, [bob.uid]);
});

test('PUT /me/close-friends: non-array → 400', async () => {
  const token = await alice.getIdToken();
  const res = await callRoute(putCloseFriends, 'PUT', { token, body: { ids: 'nope' } });
  assert.equal(res.status, 400);
});

// ─── audience leaks closed (review fixes) ───────────────────────────────────

test('comment thread of a restricted post is hidden from outsiders + anonymous', async () => {
  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'private', visibility: 'only_me' });
  // author can comment on their own post
  const c = await callRoute(createComment, 'POST', { token: aToken, params: { id }, body: { text: 'mine' } });
  assert.equal(c.status, 200, JSON.stringify(c.body));

  // author sees the thread
  const mine = await callRoute<{ comments: unknown[] }>(getComments, 'GET', { token: aToken, params: { id } });
  if (mine.body.ok !== true) return assert.fail('ok');
  assert.equal(mine.body.data.comments.length, 1);

  // outsider + anonymous get an empty thread (not the leaked comments)
  const outsider = await callRoute<{ comments: unknown[] }>(getComments, 'GET', { token: await bob.getIdToken(), params: { id } });
  if (outsider.body.ok !== true) return assert.fail('ok');
  assert.equal(outsider.body.data.comments.length, 0, 'outsider sees no comments');

  const anon = await callRoute<{ comments: unknown[] }>(getComments, 'GET', { params: { id } });
  if (anon.body.ok !== true) return assert.fail('ok');
  assert.equal(anon.body.data.comments.length, 0, 'anonymous sees no comments');
});

test('an outsider cannot comment on a restricted post (404, no existence oracle)', async () => {
  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'private', visibility: 'only_me' });
  const res = await callRoute(createComment, 'POST', { token: await bob.getIdToken(), params: { id }, body: { text: 'sneak' } });
  assert.equal(res.status, 404);
});

test('an outsider cannot like a restricted post (404, no existence oracle)', async () => {
  const aToken = await alice.getIdToken();
  const id = await makePost(aToken, { text: 'private', visibility: 'only_me' });
  const res = await callRoute(likePost, 'POST', { token: await bob.getIdToken(), params: { id } });
  assert.equal(res.status, 404);
});

test('@-mention on a restricted post does NOT notify an out-of-audience user', async () => {
  const aToken = await alice.getIdToken();
  // only_me → audience is just the author; bob is mentioned but not in audience.
  await makePost(aToken, { text: 'secret @bob', visibility: 'only_me' });
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', bob.uid).where('type', '==', 'post_tag').get();
  assert.equal(notifs.size, 0, 'no tag notification leaks the restricted post');
});

test('@-mention on a public post still notifies (control)', async () => {
  const aToken = await alice.getIdToken();
  await makePost(aToken, { text: 'hey @bob', visibility: 'everyone' });
  const notifs = await adminDb().collection('notifications')
    .where('userId', '==', bob.uid).where('type', '==', 'post_tag').get();
  assert.equal(notifs.size, 1);
});

test('home-feed pagination is not dead-ended by a hidden post in the window', async () => {
  const carol = await createTestUser('carol');
  await adminDb().collection('users').doc(carol.uid).set({ uid: carol.uid, username: 'carol', usernameLower: 'carol' });
  // newest → oldest: P1 everyone(alice), P2 only_me(carol, hidden to bob),
  // P3 everyone(alice), P4 everyone(alice). With limit=2 the +1 window is P1,P2,P3;
  // the old code dropped P2 and wrongly reported hasMore=false, hiding P4.
  const mk = (id: string, authorId: string, t: number, visibility: string, audienceUids?: string[]) =>
    adminDb().collection('posts').doc(id).set({
      id, authorId, text: id, media: [], taggedMovie: null, rating: null,
      taggedUserIds: [], taggedUsers: [], place: null, visibility,
      ...(audienceUids ? { audienceUids } : {}),
      likes: 0, likedBy: [], commentCount: 0,
      createdAt: new Date(2024, 0, t), updatedAt: new Date(2024, 0, t),
    });
  await mk('P1', alice.uid, 4, 'everyone');
  await mk('P2', carol.uid, 3, 'only_me', []);
  await mk('P3', alice.uid, 2, 'everyone');
  await mk('P4', alice.uid, 1, 'everyone');

  const bobToken = await bob.getIdToken();
  const page1 = await callRoute<{ items: { post: { id: string } }[]; hasMore: boolean; nextCursor?: string }>(
    homeFeed, 'GET', { token: bobToken, url: 'http://test/api/v1/home-feed?limit=2' });
  if (page1.body.ok !== true) return assert.fail('ok');
  assert.equal(page1.body.data.items.length, 2, 'two visible posts on page 1');
  assert.equal(page1.body.data.hasMore, true, 'more remain (P4) — not dead-ended by the hidden P2');
  const ids1 = page1.body.data.items.map((i) => i.post.id);
  assert.deepEqual(ids1, ['P1', 'P3']);

  const page2 = await callRoute<{ items: { post: { id: string } }[] }>(
    homeFeed, 'GET', { token: bobToken, url: `http://test/api/v1/home-feed?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor!)}` });
  if (page2.body.ok !== true) return assert.fail('ok');
  assert.deepEqual(page2.body.data.items.map((i) => i.post.id), ['P4'], 'page 2 surfaces the previously-hidden-tail visible post');
});
