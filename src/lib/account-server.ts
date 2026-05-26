/**
 * Account deletion — extracted from the original `deleteUserAccount` Server
 * Action (Phase A PR #2). The 200-line cascade is too heavy to inline at a
 * route handler. Pure server-side module — no `'use server'`, takes an
 * already-verified uid (the route wrapper does the auth check).
 *
 * Cascade order matters: collaborator removal happens BEFORE list deletion
 * (otherwise we'd try to remove the deleted user from lists that no longer
 * exist), Firebase Auth deletion last (it's external and non-fatal if it
 * fails — the user is functionally gone after the Firestore writes complete).
 *
 * AUDIT.md 1.2: the original action accepted (idToken, confirmUsername) — but
 * the username was just a typed "are you sure" check against the caller's
 * OWN name, not a security gate. This helper keeps that confirmation: the
 * caller passes the verified uid + the typed string; we verify the string
 * matches what's stored. Mismatch → ConfirmationMismatchError.
 *
 * AUDIT.md 2.7: collaborator removal uses a single collectionGroup query
 * (O(collaborator-lists)) instead of an O(total users) full scan. Requires
 * the `lists`/`collaboratorIds` collection-group field override in
 * `firestore.indexes.json` — already in place.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getDb, getFirebaseAdminApp } from '@/firebase/admin';

/** Throws inside `deleteAccount` when the typed confirmation doesn't match
 *  the user's stored username. Route handler catches and maps to 400. */
export class ConfirmationMismatchError extends Error {
  constructor() {
    super('Username does not match. Please enter your exact username to confirm deletion.');
    this.name = 'ConfirmationMismatchError';
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found.');
    this.name = 'UserNotFoundError';
  }
}

const BATCH_LIMIT = 450; // Firestore allows 500 writes/batch; stay under it.

/**
 * Hard-deletes a user account and all associated data. Caller must have
 * already verified the uid (e.g. via `apiRoute` → `verifyCaller`).
 *
 * @throws ConfirmationMismatchError — `confirmUsername` doesn't match.
 * @throws UserNotFoundError — no user doc exists for this uid.
 */
export async function deleteAccount(uid: string, confirmUsername: string): Promise<void> {
  const db = getDb();
  const adminApp = getFirebaseAdminApp();
  const auth = getAuth(adminApp);

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new UserNotFoundError();

  const userData = userDoc.data();
  const actualUsername = (userData?.username ?? '').toLowerCase();
  const providedUsername = confirmUsername.toLowerCase().trim();
  if (actualUsername !== providedUsername) throw new ConfirmationMismatchError();

  console.log(`[deleteAccount] Starting deletion for user: ${uid}`);

  // 1. Reviews
  const reviewsSnapshot = await db.collection('reviews').where('userId', '==', uid).get();
  let batch = db.batch();
  let count = 0;
  for (const doc of reviewsSnapshot.docs) {
    batch.delete(doc.ref);
    if (++count >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  console.log(`[deleteAccount] Deleted ${reviewsSnapshot.size} reviews`);

  // 2. Ratings
  const ratingsSnapshot = await db.collection('ratings').where('userId', '==', uid).get();
  batch = db.batch(); count = 0;
  for (const doc of ratingsSnapshot.docs) {
    batch.delete(doc.ref);
    if (++count >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  console.log(`[deleteAccount] Deleted ${ratingsSnapshot.size} ratings`);

  // 3. Invites (sent + received)
  const [sentInvites, receivedInvites] = await Promise.all([
    db.collection('invites').where('inviterId', '==', uid).get(),
    db.collection('invites').where('inviteeId', '==', uid).get(),
  ]);
  batch = db.batch();
  for (const doc of sentInvites.docs) batch.delete(doc.ref);
  for (const doc of receivedInvites.docs) batch.delete(doc.ref);
  await batch.commit();
  console.log(`[deleteAccount] Deleted invites`);

  // 4. Collaborations — AUDIT.md 2.7: scoped collectionGroup query, not full scan.
  const collabLists = await db
    .collectionGroup('lists')
    .where('collaboratorIds', 'array-contains', uid)
    .get();
  batch = db.batch(); count = 0;
  for (const listDoc of collabLists.docs) {
    // Skip lists owned by the user being deleted — those are removed
    // outright in step 5; arrayRemove there would be redundant.
    if (listDoc.ref.parent.parent?.id === uid) continue;
    batch.update(listDoc.ref, { collaboratorIds: FieldValue.arrayRemove(uid) });
    if (++count >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  console.log(`[deleteAccount] Removed from ${collabLists.size} collaborations`);

  // 5. Own lists + movies subcollections.
  const userListsSnapshot = await db.collection('users').doc(uid).collection('lists').get();
  for (const listDoc of userListsSnapshot.docs) {
    const moviesSnapshot = await listDoc.ref.collection('movies').get();
    batch = db.batch(); count = 0;
    for (const movieDoc of moviesSnapshot.docs) {
      batch.delete(movieDoc.ref);
      if (++count >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    await listDoc.ref.delete();
  }
  console.log(`[deleteAccount] Deleted ${userListsSnapshot.size} lists`);

  // 6. Follower / following relationships.
  const followersSnapshot = await db.collection('users').doc(uid).collection('followers').get();
  for (const followerDoc of followersSnapshot.docs) {
    const followerId = followerDoc.id;
    await db.collection('users').doc(followerId).collection('following').doc(uid).delete();
    await db.collection('users').doc(followerId).update({
      followingCount: FieldValue.increment(-1),
    });
    await followerDoc.ref.delete();
  }
  const followingSnapshot = await db.collection('users').doc(uid).collection('following').get();
  for (const followingDoc of followingSnapshot.docs) {
    const followingId = followingDoc.id;
    await db.collection('users').doc(followingId).collection('followers').doc(uid).delete();
    await db.collection('users').doc(followingId).update({
      followersCount: FieldValue.increment(-1),
    });
    await followingDoc.ref.delete();
  }
  console.log(`[deleteAccount] Deleted follow relationships`);

  // 7. Username reservation.
  if (userData?.username) {
    await db.collection('usernames').doc(userData.username).delete();
  }

  // 8. The user document itself.
  await db.collection('users').doc(uid).delete();

  // 9. Firebase Auth — external, non-fatal if it fails; the user is already
  //    gone from Firestore at this point.
  try {
    await auth.deleteUser(uid);
  } catch (authError: unknown) {
    const msg = authError instanceof Error ? authError.message : String(authError);
    console.error(`[deleteAccount] Auth deletion error (non-fatal): ${msg}`);
  }

  console.log(`[deleteAccount] Successfully deleted account for user: ${uid}`);
}
