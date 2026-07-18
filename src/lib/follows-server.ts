/**
 * Follow-relationship server logic — Phase A PR #7.
 *
 * Pure server-side module. Each function takes a verified caller uid; the
 * route wrapper does the auth check. Errors are thrown as typed classes
 * so the route maps them to HTTP status.
 *
 * Closes / preserves:
 *   - AUDIT.md 3.8 (follow-rate-limit segment) — `followUser` is invoked
 *     behind a per-user `checkRateLimit(uid, 'follow')` gate at the route
 *     layer (kept where it was; this module is the business logic).
 *   - AUDIT.md latent count-drift (parallel to 2.2 movieCount): `unfollowUser`
 *     used to ALWAYS decrement, even if the follow doc was already gone
 *     (concurrent double-unfollow, stale UI). It now runs inside a
 *     transaction with an existence check — ghost unfollows are no-ops, no
 *     negative count drift.
 *   - LAUNCH.md 0.5.5 — block in either direction severs interaction; a
 *     blocked caller cannot follow the target.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { sendPushToUser } from '@/lib/push-server';
import { isBlockedBetween } from '@/lib/blocks-server';
import { createTtlCache, cached } from '@/lib/server-cache';
import type { UserProfile } from '@/lib/types';

// The follow-id SET is read per home load by BOTH the leaderboard and
// friends-watching rails (N reads each, N = # follows). It changes rarely, so
// cache per-user (5min) and invalidate on follow/unfollow.
const followingIdsCache = createTtlCache<string[]>({ ttlMs: 300_000 });
function invalidateFollowingIds(uid: string): void {
  followingIdsCache.deleteByPrefix(`${uid}:`);
}

// The follower-id SET powers "mutuals" (post audience = follow-back). Same
// rarely-changing shape as following; cache 5min, invalidate the TARGET's set
// whenever a follow edge to them is created/removed.
const followerIdsCache = createTtlCache<string[]>({ ttlMs: 300_000 });
function invalidateFollowerIds(uid: string): void {
  followerIdsCache.deleteByPrefix(`${uid}:`);
}

// ─── Typed errors ─────────────────────────────────────────────────────────

export class SelfFollowError extends Error {
  constructor(message = "You can't follow yourself.") {
    super(message);
    this.name = 'SelfFollowError';
  }
}

export class FollowBlockedError extends Error {
  /** Intentionally generic: don't leak whether the block is one direction
   *  or the other (or that a block exists at all). */
  constructor(message = 'Unable to follow this user.') {
    super(message);
    this.name = 'FollowBlockedError';
  }
}

export class AlreadyFollowingError extends Error {
  constructor(message = 'Already following this user.') {
    super(message);
    this.name = 'AlreadyFollowingError';
  }
}

export class TargetUserNotFoundError extends Error {
  constructor(message = 'User not found.') {
    super(message);
    this.name = 'TargetUserNotFoundError';
  }
}

// ─── followUser ───────────────────────────────────────────────────────────

/**
 * Create a follow edge: caller → target. Writes the symmetric pair of
 * `following/{target}` + `followers/{caller}` docs AND increments both
 * counters atomically.
 *
 * Best-effort follow notification post-commit (respects the target's
 * `notificationPreferences.follows`). Notification failure cannot roll
 * back the follow — matches legacy behavior.
 */
export async function followUser(
  callerUid: string,
  targetUid: string,
): Promise<void> {
  if (!targetUid || typeof targetUid !== 'string') {
    throw new TargetUserNotFoundError();
  }
  if (callerUid === targetUid) throw new SelfFollowError();

  const db = getDb();

  // Block check (either direction blocks the follow).
  if (await isBlockedBetween(db, callerUid, targetUid)) {
    throw new FollowBlockedError();
  }

  // Verify target exists. Avoids creating dangling follow edges if a uid
  // is mis-typed or the target deleted their account.
  const targetDoc = await db.collection('users').doc(targetUid).get();
  if (!targetDoc.exists) throw new TargetUserNotFoundError();

  const followerRef = db
    .collection('users').doc(targetUid)
    .collection('followers').doc(callerUid);
  const followingRef = db
    .collection('users').doc(callerUid)
    .collection('following').doc(targetUid);
  const followerUserRef = db.collection('users').doc(callerUid);
  const targetUserRef = db.collection('users').doc(targetUid);

  // Transactional write — the existence check on the following doc + the
  // symmetric write + both counter increments happen atomically. Two
  // concurrent follow attempts collapse to one increment via Firestore's
  // contention retry.
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(followingRef);
    if (existing.exists) {
      throw new AlreadyFollowingError();
    }
    const followDoc = {
      followerId: callerUid,
      followingId: targetUid,
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.set(followingRef, { id: targetUid, ...followDoc });
    tx.set(followerRef, { id: callerUid, ...followDoc });
    tx.update(followerUserRef, { followingCount: FieldValue.increment(1) });
    tx.update(targetUserRef, { followersCount: FieldValue.increment(1) });
  });
  invalidateFollowingIds(callerUid); // the caller's follow set changed
  invalidateFollowerIds(targetUid); // the target gained a follower (mutuals)

  // Best-effort follow notification. Failure here doesn't roll back.
  try {
    const targetData = targetDoc.data();
    const prefs = targetData?.notificationPreferences;
    if (!prefs || prefs.follows !== false) {
      const callerDoc = await db.collection('users').doc(callerUid).get();
      const callerData = callerDoc.data();
      await db.collection('notifications').add({
        userId: targetUid,
        type: 'follow',
        fromUserId: callerUid,
        fromUsername: callerData?.username || null,
        fromDisplayName: callerData?.displayName || null,
        fromPhotoUrl: callerData?.photoURL || null,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      const callerName = callerData?.username
        ? `@${callerData.username}`
        : callerData?.displayName || 'Someone';
      void sendPushToUser(targetUid, {
        title: `${callerName} followed you`,
        body: 'tap to see their profile.',
        data: {
          type: 'follow',
          fromUserId: callerUid,
          ...(callerData?.username ? { url: `/profile/${callerData.username}` } : {}),
        },
      }).catch((err) => console.error('[followUser] push failed:', err));
    }
  } catch (err) {
    console.error('[followUser] notification create failed:', err);
  }
}

// ─── unfollowUser ─────────────────────────────────────────────────────────

/**
 * Drop the follow edge if it exists. Idempotent: a ghost unfollow
 * (concurrent double-tap, stale UI) is a no-op — count is only decremented
 * when the edge actually existed. Fixes the count-drift-to-negative bug
 * the legacy batched-without-check write was prone to.
 *
 * Returns whether an unfollow actually occurred. Most callers ignore it
 * (the client just re-renders), but it lets tests assert idempotency.
 */
export async function unfollowUser(
  callerUid: string,
  targetUid: string,
): Promise<{ unfollowed: boolean }> {
  const db = getDb();

  const followerRef = db
    .collection('users').doc(targetUid)
    .collection('followers').doc(callerUid);
  const followingRef = db
    .collection('users').doc(callerUid)
    .collection('following').doc(targetUid);
  const followerUserRef = db.collection('users').doc(callerUid);
  const targetUserRef = db.collection('users').doc(targetUid);

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(followingRef);
    if (!existing.exists) return { unfollowed: false };

    tx.delete(followingRef);
    tx.delete(followerRef);
    tx.update(followerUserRef, { followingCount: FieldValue.increment(-1) });
    tx.update(targetUserRef, { followersCount: FieldValue.increment(-1) });
    return { unfollowed: true };
  });
  if (result.unfollowed) {
    invalidateFollowingIds(callerUid);
    invalidateFollowerIds(targetUid);
  }
  return result;
}

// ─── getFollowers / getFollowing ──────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
// IDs-only reads (getFollowingIds / getFollowerIds) hydrate NO profiles — one
// query, doc-ids only — so they can scan far deeper than the profile-hydrating
// lists. This is the ceiling for the follow SET used by mutuals/leaderboard/
// friends-watching, so a 'friends' post or a top-watcher tally isn't silently
// capped at 200.
const MAX_ID_LIMIT = 2000;

function profileFromDoc(
  doc: FirebaseFirestore.DocumentSnapshot,
  fallbackUid: string,
): UserProfile {
  const data = doc.data() || {};
  return {
    uid: data.uid || fallbackUid,
    email: data.email || '',
    displayName: data.displayName || null,
    photoURL: data.photoURL || null,
    username: data.username || null,
    bio: data.bio || null,
    createdAt:
      (data.createdAt?.toDate?.() ?? new Date()).toISOString() as unknown as Date,
    followersCount: data.followersCount || 0,
    followingCount: data.followingCount || 0,
  };
}

/**
 * Public list of `targetUid`'s followers. No auth required — follow
 * relationships are public. Callers wanting block-filtering should fetch
 * their block set separately and filter client-side.
 */
export async function getFollowers(
  targetUid: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<UserProfile[]> {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIST_LIMIT);
  const db = getDb();
  const snap = await db
    .collection('users').doc(targetUid)
    .collection('followers')
    .limit(effectiveLimit)
    .get();
  if (snap.empty) return [];

  // Parallel profile fetches — legacy was sequential N+1.
  const profileDocs = await Promise.all(
    snap.docs.map((d) => db.collection('users').doc(d.id).get()),
  );
  return profileDocs
    .filter((d) => d.exists)
    .map((d) => profileFromDoc(d, d.id));
}

/**
 * Public list of users that `targetUid` follows.
 */
export async function getFollowing(
  targetUid: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<UserProfile[]> {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIST_LIMIT);
  const db = getDb();
  const snap = await db
    .collection('users').doc(targetUid)
    .collection('following')
    .limit(effectiveLimit)
    .get();
  if (snap.empty) return [];

  const profileDocs = await Promise.all(
    snap.docs.map((d) => db.collection('users').doc(d.id).get()),
  );
  return profileDocs
    .filter((d) => d.exists)
    .map((d) => profileFromDoc(d, d.id));
}

/**
 * Just the UIDs the target follows — ONE read, no profile hydration. Use this
 * (not `getFollowing`) when you only need the follow SET for membership/scoping
 * (e.g. the leaderboard), since the `following` subcollection doc id IS the
 * followed uid. Saves up to `limit` per-profile reads per call.
 */
export async function getFollowingIds(
  targetUid: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<string[]> {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_ID_LIMIT);
  // cached() auto-bypasses under the test emulator, so tests see fresh follows.
  return cached(followingIdsCache, `${targetUid}:${effectiveLimit}`, async () => {
    const db = getDb();
    const snap = await db
      .collection('users').doc(targetUid)
      .collection('following')
      .limit(effectiveLimit)
      .get();
    return snap.docs.map((d) => d.id);
  });
}

/**
 * Just the UIDs that follow the target — ONE read, no profile hydration.
 * Mirror of `getFollowingIds` for the followers side. Cached 5min.
 */
export async function getFollowerIds(
  targetUid: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<string[]> {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_ID_LIMIT);
  return cached(followerIdsCache, `${targetUid}:${effectiveLimit}`, async () => {
    const db = getDb();
    const snap = await db
      .collection('users').doc(targetUid)
      .collection('followers')
      .limit(effectiveLimit)
      .get();
    return snap.docs.map((d) => d.id);
  });
}

/**
 * The target's MUTUALS — users they follow who also follow them back. This is
 * the "friends" audience for posts. Two cached set reads + an in-memory
 * intersection (no per-edge reads). Scans the full follow graph (MAX_ID_LIMIT)
 * so a large account's 'friends' audience isn't silently truncated.
 */
export async function getMutualIds(targetUid: string): Promise<string[]> {
  const [following, followers] = await Promise.all([
    getFollowingIds(targetUid, MAX_ID_LIMIT),
    getFollowerIds(targetUid, MAX_ID_LIMIT),
  ]);
  const followerSet = new Set(followers);
  return following.filter((id) => followerSet.has(id));
}

// ─── Close friends (server-only inner circle) ───────────────────────────────

// Stored in a server-only top-level doc `/closeFriends/{uid}` ({ ids: [] }) so
// a user's inner circle never leaks through a client-readable profile doc
// (firestore.rules denies all client access; Admin SDK reads/writes here).
const MAX_CLOSE_FRIENDS = 150;

export async function getCloseFriendIds(uid: string): Promise<string[]> {
  const db = getDb();
  const snap = await db.collection('closeFriends').doc(uid).get();
  const ids = snap.exists ? snap.data()?.ids : null;
  return Array.isArray(ids) ? ids : [];
}

/**
 * Replace the caller's close-friends list. Dedupes, drops self, caps at 150.
 * (No follow-relationship requirement — you can keep anyone close.)
 */
export async function setCloseFriendIds(
  callerUid: string,
  ids: string[],
): Promise<{ ids: string[] }> {
  const clean = [...new Set(Array.isArray(ids) ? ids : [])]
    .filter((id) => typeof id === 'string' && id && id !== callerUid)
    .slice(0, MAX_CLOSE_FRIENDS);
  const db = getDb();
  await db.collection('closeFriends').doc(callerUid).set({
    uid: callerUid,
    ids: clean,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ids: clean };
}

// ─── isFollowing — single boolean check (Phase A PR #18) ────────────────

/**
 * Does `followerId` currently follow `followingId`? Used by the
 * <FollowButton> component to render the initial state and by
 * notification rendering for "follow back" hints.
 */
export async function isFollowing(
  followerId: string,
  followingId: string,
): Promise<{ isFollowing: boolean }> {
  const db = getDb();
  const followDoc = await db
    .collection('users').doc(followerId)
    .collection('following').doc(followingId).get();
  return { isFollowing: followDoc.exists };
}

/**
 * Two-way follow check between the caller (`viewerUid`) and a target
 * user, returned in one round trip. `isFollowing` = does viewer follow
 * target; `isFollowedBy` = does target follow viewer (drives the
 * "Follow back" affordance on the button).
 */
export async function getFollowRelationship(
  viewerUid: string,
  targetUid: string,
): Promise<{ isFollowing: boolean; isFollowedBy: boolean }> {
  const db = getDb();
  const [forward, reverse] = await Promise.all([
    db.collection('users').doc(viewerUid).collection('following').doc(targetUid).get(),
    db.collection('users').doc(targetUid).collection('following').doc(viewerUid).get(),
  ]);
  return { isFollowing: forward.exists, isFollowedBy: reverse.exists };
}
