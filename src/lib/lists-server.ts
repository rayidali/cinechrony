/**
 * List-domain server logic — Phase A PR #3.
 *
 * Pure server-side module (no `'use server'`). Each function takes an
 * already-verified uid; the route wrapper does the auth check. Errors are
 * thrown as typed classes so the route can map them to the right HTTP code.
 *
 * The transferOwnership cascade (AUDIT.md 1.3 + 2.1) and the deleteList
 * cascade (movies subcollection + pending invite revocation) are the heavy
 * pieces — too big to live inline in route files.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';

const BATCH_LIMIT = 450; // Firestore allows 500/batch; leave headroom.

// ─── Typed errors → route maps to HTTP status ─────────────────────────────

export class ListNotFoundError extends Error {
  constructor(message = 'List not found.') {
    super(message);
    this.name = 'ListNotFoundError';
  }
}

export class NotListOwnerError extends Error {
  constructor(action = 'modify') {
    super(`Only the list owner can ${action} the list.`);
    this.name = 'NotListOwnerError';
  }
}

export class CannotDeleteDefaultListError extends Error {
  constructor() {
    super('Cannot delete your default list.');
    this.name = 'CannotDeleteDefaultListError';
  }
}

export class ListValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListValidationError';
  }
}

export class TransferTargetNotCollaboratorError extends Error {
  constructor() {
    super('New owner must be an existing collaborator.');
    this.name = 'TransferTargetNotCollaboratorError';
  }
}

// ─── canEditList — owner OR collaborator ──────────────────────────────────

/**
 * Owner or collaborator on the list at `users/{ownerId}/lists/{listId}`.
 * Mirrors the helper in actions.ts (kept there for use by other still-Server-
 * Action operations like updateMovieNote, inviteToList — those migrate in
 * later PRs). After PR #4 ships, this becomes the only definition.
 */
export async function canEditList(
  uid: string,
  listOwnerId: string,
  listId: string,
): Promise<boolean> {
  if (uid === listOwnerId) return true;
  const db = getDb();
  const listDoc = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .get();
  if (!listDoc.exists) return false;
  const collaboratorIds: string[] = listDoc.data()?.collaboratorIds || [];
  return collaboratorIds.includes(uid);
}

// ─── createList ───────────────────────────────────────────────────────────

export type CreateListOptions = {
  isPublic?: boolean;
  description?: string;
  coverMode?: 'auto' | 'custom';
  coverImageUrl?: string;
  collaboratorInvites?: Array<{ uid: string; username?: string | null }>;
};

/**
 * Create a list under the verified caller. Returns the new list id.
 * Throws `ListValidationError` on missing/too-long name.
 *
 * Best-effort invite fan-out: if any invite write fails, the list itself
 * still ships — invite errors are logged and swallowed (matches legacy
 * behavior; the user can re-invite from the list-settings screen).
 */
export async function createList(
  uid: string,
  rawName: string,
  opts: CreateListOptions = {},
): Promise<{ listId: string }> {
  const name = rawName.trim();
  if (!name) throw new ListValidationError('A list needs a name.');
  if (name.length > 80) throw new ListValidationError('List name is too long.');

  const isPublic = opts.isPublic ?? false; // v3 default: private.
  const description = (opts.description ?? '').trim().slice(0, 280) || null;
  const coverImageUrl = opts.coverImageUrl || null;
  const coverMode: 'auto' | 'custom' = coverImageUrl ? 'custom' : opts.coverMode ?? 'auto';
  const invites = Array.isArray(opts.collaboratorInvites)
    ? opts.collaboratorInvites.slice(0, 9)
    : [];

  const db = getDb();
  const listRef = db.collection('users').doc(uid).collection('lists').doc();

  await listRef.set({
    id: listRef.id,
    name,
    ...(description ? { description } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isDefault: false,
    isPublic,
    ownerId: uid,
    coverMode,
    ...(coverImageUrl ? { coverImageUrl } : {}),
    likes: 0,
    likedBy: [],
  });

  if (invites.length > 0) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const inviterUsername = userDoc.data()?.username ?? null;
      const inviterDisplayName = userDoc.data()?.displayName ?? null;
      const inviterPhotoUrl = userDoc.data()?.photoURL ?? null;
      for (const invitee of invites) {
        if (!invitee?.uid || invitee.uid === uid) continue;
        const inviteRef = db.collection('invites').doc();
        await inviteRef.set({
          id: inviteRef.id,
          listId: listRef.id,
          listName: name,
          listOwnerId: uid,
          inviterId: uid,
          inviterUsername,
          inviteeId: invitee.uid,
          inviteeUsername: invitee.username ?? null,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });
        await db.collection('notifications').add({
          userId: invitee.uid,
          type: 'list_invite',
          fromUserId: uid,
          fromUsername: inviterUsername,
          fromDisplayName: inviterDisplayName,
          fromPhotoUrl: inviterPhotoUrl,
          inviteId: inviteRef.id,
          listId: listRef.id,
          listOwnerId: uid,
          listName: name,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('[createList] invite fan-out failed:', err);
    }
  }

  return { listId: listRef.id };
}

// ─── updateListFields — collapsed rename/description/visibility ───────────

export type ListUpdateFields = {
  name?: string;
  description?: string;
  isPublic?: boolean;
};

/**
 * Owner-only update of any subset of { name, description, isPublic }.
 * Throws `NotListOwnerError` if caller isn't the stored owner — matches the
 * legacy per-field actions (each guarded on owner-only). Validation is light;
 * `name` empty after trim → `ListValidationError`.
 */
export async function updateListFields(
  uid: string,
  listOwnerId: string,
  listId: string,
  fields: ListUpdateFields,
): Promise<void> {
  if (uid !== listOwnerId) throw new NotListOwnerError('modify');

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  let anyField = false;

  if (fields.name !== undefined) {
    const trimmed = fields.name.trim();
    if (!trimmed) throw new ListValidationError('A list needs a name.');
    if (trimmed.length > 80) throw new ListValidationError('List name is too long.');
    updates.name = trimmed;
    anyField = true;
  }

  if (fields.description !== undefined) {
    if (typeof fields.description !== 'string') {
      throw new ListValidationError('description must be a string.');
    }
    updates.description = fields.description.trim().slice(0, 280);
    anyField = true;
  }

  if (fields.isPublic !== undefined) {
    if (typeof fields.isPublic !== 'boolean') {
      throw new ListValidationError('isPublic must be a boolean.');
    }
    updates.isPublic = fields.isPublic;
    anyField = true;
  }

  if (!anyField) throw new ListValidationError('No updatable fields provided.');

  const db = getDb();
  const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new ListNotFoundError();

  await listRef.update(updates);
}

// ─── deleteList — owner-only, cascade movies + revoke pending invites ────

export async function deleteList(
  uid: string,
  listOwnerId: string,
  listId: string,
): Promise<void> {
  if (uid !== listOwnerId) throw new NotListOwnerError('delete');

  const db = getDb();
  const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new ListNotFoundError();
  if (listDoc.data()?.isDefault) throw new CannotDeleteDefaultListError();

  // Delete all movies in the list (batched).
  const moviesSnapshot = await listRef.collection('movies').get();
  let batch = db.batch();
  let count = 0;
  for (const doc of moviesSnapshot.docs) {
    batch.delete(doc.ref);
    if (++count >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  batch.delete(listRef);
  await batch.commit();

  // Revoke pending invites for this list (any inviter, just listId+ownerId match).
  const pendingInvites = await db.collection('invites')
    .where('listId', '==', listId)
    .where('listOwnerId', '==', listOwnerId)
    .where('status', '==', 'pending')
    .get();

  if (!pendingInvites.empty) {
    let inviteBatch = db.batch();
    let inviteCount = 0;
    for (const doc of pendingInvites.docs) {
      inviteBatch.update(doc.ref, { status: 'revoked' });
      if (++inviteCount >= BATCH_LIMIT) {
        await inviteBatch.commit();
        inviteBatch = db.batch();
        inviteCount = 0;
      }
    }
    if (inviteCount > 0) await inviteBatch.commit();
  }
}

// ─── transferOwnership — AUDIT.md 1.3 + 2.1 staged pattern ────────────────

/**
 * Move ownership of a list from the verified caller to a target collaborator.
 *
 * AUDIT.md 1.3 (auth): the current owner IS the verified caller; the stored
 * `ownerId` is double-checked under an atomic pre-flight transaction to
 * defeat concurrent ownership change races.
 *
 * AUDIT.md 2.1 (integrity): subcollection moves don't fit one Firestore
 * transaction (500-op limit), so we stage:
 *   P1 — atomic pre-flight transaction (read-only verification)
 *   P2 — batched idempotent copy of movies to the new owner's path
 *   P3 — write the new list doc with swapped collaborator set
 *   P4 — re-point /invites docs from old → new owner
 *   P5 — batched delete of old movies
 *   P6 — final delete of the old list doc (canonical transition point)
 *
 * Every write is idempotent set/update — a crash before P6 leaves the source
 * intact and the operation re-runnable. Eliminates the legacy worst case
 * (movies duplicated, source orphaned).
 */
export async function transferOwnership(
  callerUid: string,
  listId: string,
  newOwnerId: string,
): Promise<{ newOwnerId: string }> {
  const db = getDb();
  const oldListRef = db.collection('users').doc(callerUid).collection('lists').doc(listId);
  const newListRef = db.collection('users').doc(newOwnerId).collection('lists').doc(listId);

  // P1 — atomic pre-flight.
  type PreflightOk = { kind: 'ok'; listData: FirebaseFirestore.DocumentData };
  type PreflightErr = { kind: 'err'; error: Error };
  const preflight: PreflightOk | PreflightErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(oldListRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ListNotFoundError() };
    const data = snap.data() || {};
    if (data.ownerId !== callerUid) {
      return { kind: 'err' as const, error: new NotListOwnerError('transfer ownership of') };
    }
    const collaboratorIds: string[] = data.collaboratorIds || [];
    if (!collaboratorIds.includes(newOwnerId)) {
      return { kind: 'err' as const, error: new TransferTargetNotCollaboratorError() };
    }
    return { kind: 'ok' as const, listData: data };
  });
  if (preflight.kind === 'err') throw preflight.error;

  const listData = preflight.listData;
  const collaboratorIds: string[] = listData.collaboratorIds || [];
  // New owner moves out of collaborators; old owner moves IN as collaborator.
  const newCollaborators = collaboratorIds
    .filter((id: string) => id !== newOwnerId)
    .concat([callerUid]);

  // P2 — copy movies.
  const moviesSnapshot = await oldListRef.collection('movies').get();
  let copyBatch = db.batch();
  let copyOps = 0;
  for (const movieDoc of moviesSnapshot.docs) {
    copyBatch.set(newListRef.collection('movies').doc(movieDoc.id), movieDoc.data());
    if (++copyOps >= BATCH_LIMIT) {
      await copyBatch.commit();
      copyBatch = db.batch();
      copyOps = 0;
    }
  }
  if (copyOps > 0) await copyBatch.commit();

  // P3 — write new list doc.
  await newListRef.set({
    ...listData,
    ownerId: newOwnerId,
    collaboratorIds: newCollaborators,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // P4 — re-point invites (idempotent: only old-owner invites are updated).
  const invitesSnapshot = await db.collection('invites')
    .where('listId', '==', listId)
    .where('listOwnerId', '==', callerUid)
    .get();
  if (!invitesSnapshot.empty) {
    let inviteBatch = db.batch();
    let inviteOps = 0;
    for (const inv of invitesSnapshot.docs) {
      inviteBatch.update(inv.ref, { listOwnerId: newOwnerId });
      if (++inviteOps >= BATCH_LIMIT) {
        await inviteBatch.commit();
        inviteBatch = db.batch();
        inviteOps = 0;
      }
    }
    if (inviteOps > 0) await inviteBatch.commit();
  }

  // P5 — delete old movies.
  let delBatch = db.batch();
  let delOps = 0;
  for (const movieDoc of moviesSnapshot.docs) {
    delBatch.delete(movieDoc.ref);
    if (++delOps >= BATCH_LIMIT) {
      await delBatch.commit();
      delBatch = db.batch();
      delOps = 0;
    }
  }
  if (delOps > 0) await delBatch.commit();

  // P6 — final cutover. A re-call after success hits P1 and returns
  // ListNotFoundError — graceful idempotent no-op.
  await oldListRef.delete();

  return { newOwnerId };
}

// ─── List cover ───────────────────────────────────────────────────────────

/** Set the cover URL on a list (or clear it). canEditList enforced. */
export async function setListCover(
  uid: string,
  listOwnerId: string,
  listId: string,
  coverImageUrl: string | null,
): Promise<void> {
  const allowed = await canEditList(uid, listOwnerId, listId);
  if (!allowed) {
    throw new NotListOwnerError('modify'); // owner-or-collaborator → 403 surface
  }
  const db = getDb();
  await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .update({ coverImageUrl, updatedAt: FieldValue.serverTimestamp() });
}
