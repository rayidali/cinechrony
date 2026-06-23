/**
 * Block-relationship helpers — Phase A PR #7 extraction (read primitives)
 * + PR #15 (write surface).
 *
 * LAUNCH.md 0.5.5 ("Block a user"): a block is mutual invisibility — both
 * directions filter out the other party. These helpers are the
 * server-side enforcement primitives; the client mirror is
 * `UserBlocksCacheProvider`.
 *
 * Blocking has cross-cutting side effects that are NOT optional and must
 * be atomic from the caller's perspective:
 *   - sever any follow relationship in both directions (with count
 *     decrements on both user docs)
 *   - revoke any pending invites between the two users
 *
 * `blockUser` does both before returning success.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { createTtlCache, cached } from '@/lib/server-cache';

// Block reads are called PER REQUEST by the feed/posts/comments/notifications
// (2 reads each). Blocks change rarely, so cache per-uid and invalidate on the
// block/unblock writes below. Short-ish TTL bounds any missed-invalidation lag.
const blockSetCache = createTtlCache<string[]>({ ttlMs: 600_000 });
const blockContextCache = createTtlCache<{ blockedIds: string[]; iBlocked: string[] }>({ ttlMs: 600_000 });
function invalidateBlocks(...uids: string[]): void {
  for (const u of uids) { blockSetCache.delete(u); blockContextCache.delete(u); }
}
import type { UserProfile } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class BlockSelfError extends Error {
  constructor(message = 'You cannot block yourself.') {
    super(message);
    this.name = 'BlockSelfError';
  }
}

/**
 * True if a block doc exists in EITHER direction between two users.
 * Use this to gate a single relationship-altering write (follow, post,
 * invite, etc.). For read-surface filtering across many candidates,
 * prefer `getBlockSet`.
 */
export async function isBlockedBetween(
  db: FirebaseFirestore.Firestore,
  a: string,
  b: string,
): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    db.collection('blocks').doc(`${a}_${b}`).get(),
    db.collection('blocks').doc(`${b}_${a}`).get(),
  ]);
  return ab.exists || ba.exists;
}

/**
 * The set of uids invisible to `uid` — everyone they blocked plus everyone
 * who blocked them. Used to filter read surfaces server-side (search,
 * feeds, lists of followers/following).
 */
export async function getBlockSet(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<Set<string>> {
  const ids = await cached(blockSetCache, uid, async () => {
    const [iBlocked, blockedMe] = await Promise.all([
      db.collection('blocks').where('blockerId', '==', uid).limit(500).get(),
      db.collection('blocks').where('blockedId', '==', uid).limit(500).get(),
    ]);
    const set = new Set<string>();
    iBlocked.docs.forEach((d) => set.add(d.data().blockedId as string));
    blockedMe.docs.forEach((d) => set.add(d.data().blockerId as string));
    return [...set];
  });
  return new Set(ids);
}

/** Convenience: defaults to the canonical `getDb()`. */
export function getMyBlockSet(uid: string): Promise<Set<string>> {
  return getBlockSet(getDb(), uid);
}

// ═════════════════════════════════════════════════════════════════════════
// WRITE SURFACE (Phase A PR #15)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Block a user — writes the block doc, severs any follow in both
 * directions (with count decrements), revokes pending invites both ways.
 * No-op if `blockerUid === blockedUid` would otherwise be allowed; we
 * reject as `BlockSelfError`.
 */
export async function blockUser(
  blockerUid: string,
  blockedUid: string,
): Promise<void> {
  if (!blockedUid || blockedUid === blockerUid) throw new BlockSelfError();
  const db = getDb();

  await db.collection('blocks').doc(`${blockerUid}_${blockedUid}`).set({
    blockerId: blockerUid,
    blockedId: blockedUid,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Sever the follow relationship in BOTH directions, with count decrements.
  const batch = db.batch();
  for (const [a, b] of [[blockerUid, blockedUid], [blockedUid, blockerUid]] as const) {
    const followingRef = db.collection('users').doc(a).collection('following').doc(b);
    if ((await followingRef.get()).exists) {
      batch.delete(followingRef);
      batch.delete(db.collection('users').doc(b).collection('followers').doc(a));
      batch.update(db.collection('users').doc(a), {
        followingCount: FieldValue.increment(-1),
      });
      batch.update(db.collection('users').doc(b), {
        followersCount: FieldValue.increment(-1),
      });
    }
  }
  await batch.commit();

  // Revoke pending invites between the two (best-effort). TARGETED queries —
  // the old code scanned EVERY pending invite in the whole app (an unbounded
  // global read that scales with total invites). Now we read only invites
  // where one of the two is the inviter. [free-tier read reduction]
  try {
    // Single-field equality (auto-indexed, no composite index needed); a
    // user's sent invites are few, so filter status + counterparty in memory.
    const [aSent, bSent] = await Promise.all([
      db.collection('invites').where('inviterId', '==', blockerUid).get(),
      db.collection('invites').where('inviterId', '==', blockedUid).get(),
    ]);
    const invBatch = db.batch();
    let touched = false;
    for (const d of [...aSent.docs, ...bSent.docs]) {
      const inv = d.data();
      if (inv.status !== 'pending') continue;
      if (
        (inv.inviterId === blockerUid && inv.inviteeId === blockedUid) ||
        (inv.inviterId === blockedUid && inv.inviteeId === blockerUid)
      ) {
        invBatch.update(d.ref, { status: 'revoked' });
        touched = true;
      }
    }
    if (touched) await invBatch.commit();
  } catch (err) {
    console.error('[blockUser] invite revoke failed:', err);
  }

  // Both users' block views changed — clear so the new block takes effect now.
  invalidateBlocks(blockerUid, blockedUid);
}

/**
 * Unblock — only removes the caller's outgoing block. The relationship is
 * not restored (no re-follow); LAUNCH.md 0.5.5.
 */
export async function unblockUser(
  callerUid: string,
  blockedUid: string,
): Promise<void> {
  const db = getDb();
  await db.collection('blocks').doc(`${callerUid}_${blockedUid}`).delete();
  invalidateBlocks(callerUid, blockedUid);
}

/**
 * `blockedIds` is the invisibility union (everyone the viewer can't see and
 * everyone who can't see the viewer — filter feeds, search, and member
 * lists with it). `iBlocked` is just the viewer's OUTGOING blocks (drives
 * the settings unblock list).
 */
export async function getMyBlockContext(
  callerUid: string,
): Promise<{ blockedIds: string[]; iBlocked: string[] }> {
  return cached(blockContextCache, callerUid, async () => {
    const db = getDb();
    const [iBlockedSnap, blockedMeSnap] = await Promise.all([
      db.collection('blocks').where('blockerId', '==', callerUid).limit(500).get(),
      db.collection('blocks').where('blockedId', '==', callerUid).limit(500).get(),
    ]);
    const iBlocked = iBlockedSnap.docs.map((d) => d.data().blockedId as string);
    const blockedMe = blockedMeSnap.docs.map((d) => d.data().blockerId as string);
    return { blockedIds: [...new Set([...iBlocked, ...blockedMe])], iBlocked };
  });
}

/**
 * Profiles for the viewer's blocked users — drives the settings unblock
 * list UI. Hides email per AUDIT 1.9.
 */
export async function getBlockedUsers(
  callerUid: string,
): Promise<{ users: UserProfile[] }> {
  const db = getDb();
  const snap = await db.collection('blocks').where('blockerId', '==', callerUid).get();
  const ids = snap.docs.map((d) => d.data().blockedId as string);
  if (ids.length === 0) return { users: [] };
  const docs = await db.getAll(...ids.map((id) => db.collection('users').doc(id)));
  const users = docs
    .filter((d) => d.exists)
    .map((d) => {
      const u = d.data() || {};
      return {
        uid: d.id,
        email: '', // 1.9 — never returned
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        username: u.username ?? null,
        bio: u.bio ?? null,
        createdAt: u.createdAt?.toDate?.() ?? new Date(),
        followersCount: u.followersCount ?? 0,
        followingCount: u.followingCount ?? 0,
      } as UserProfile;
    });
  return { users };
}
