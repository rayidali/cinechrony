/**
 * Mute helpers — Phase A PR #15.
 *
 * Muting hides a user's cards from the viewer's feed. Unlike a block,
 * mutes are unilateral and silent — the muted user can still see the
 * viewer, follow them, etc. The viewer's `UserMutesCacheProvider` loads
 * the mute set once on mount; feed filtering happens client-side against
 * that set.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class MuteSelfError extends Error {
  constructor(message = 'You cannot mute yourself.') {
    super(message);
    this.name = 'MuteSelfError';
  }
}

// ─── muteUser / unmuteUser ───────────────────────────────────────────────

export async function muteUser(
  callerUid: string,
  mutedId: string,
): Promise<void> {
  if (!mutedId || mutedId === callerUid) throw new MuteSelfError();
  const db = getDb();
  await db
    .collection('users').doc(callerUid)
    .collection('mutes').doc(mutedId)
    .set({ mutedId, createdAt: FieldValue.serverTimestamp() });
}

export async function unmuteUser(
  callerUid: string,
  mutedId: string,
): Promise<void> {
  const db = getDb();
  await db
    .collection('users').doc(callerUid)
    .collection('mutes').doc(mutedId)
    .delete();
}

// ─── getMyMutes — cache hydrator ─────────────────────────────────────────

export async function getMyMutes(
  callerUid: string,
): Promise<{ mutedIds: string[] }> {
  const db = getDb();
  const snap = await db
    .collection('users').doc(callerUid)
    .collection('mutes').get();
  return { mutedIds: snap.docs.map((d) => d.id) };
}
