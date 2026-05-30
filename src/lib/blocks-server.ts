/**
 * Block-relationship helpers — Phase A PR #7 extraction.
 *
 * These were private helpers inside `src/app/actions.ts`. That file is
 * `'use server'`, which means every export is a Server Action. We need
 * these reachable from other server modules (follows, future safety/feed
 * helpers) without dragging actions.ts into their import graph, so they
 * live here.
 *
 * LAUNCH.md 0.5.5 ("Block a user"): a block is mutual invisibility — both
 * directions filter out the other party. These helpers are the
 * server-side enforcement primitives; the client mirror is
 * `UserBlocksCacheProvider`.
 */

import { getDb } from '@/firebase/admin';

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
  const [iBlocked, blockedMe] = await Promise.all([
    db.collection('blocks').where('blockerId', '==', uid).get(),
    db.collection('blocks').where('blockedId', '==', uid).get(),
  ]);
  const set = new Set<string>();
  iBlocked.docs.forEach((d) => set.add(d.data().blockedId as string));
  blockedMe.docs.forEach((d) => set.add(d.data().blockerId as string));
  return set;
}

/** Convenience: defaults to the canonical `getDb()`. */
export function getMyBlockSet(uid: string): Promise<Set<string>> {
  return getBlockSet(getDb(), uid);
}
