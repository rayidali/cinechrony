/**
 * Collaborator-domain server logic — Phase A PR #6.
 *
 * Two operations:
 *   - `removeCollaborator` — owner-only kick. Closes AUDIT.md 1.4: the legacy
 *     check was tautological (`listData.ownerId !== ownerId` where both
 *     `ownerId`s were the same client-supplied param). Now the stored owner
 *     is compared against the cryptographically-verified caller.
 *   - `leaveList` — the caller removes themselves. Owners cannot leave their
 *     own list (must transfer ownership or delete first).
 *
 * Errors are thrown as typed classes so the route maps them to HTTP status.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import {
  ListNotFoundError, NotListOwnerError,
  invalidateCollaborativeLists, invalidateListMembers,
} from '@/lib/lists-server';

export { ListNotFoundError, NotListOwnerError };

// ─── Typed errors ─────────────────────────────────────────────────────────

export class NotCollaboratorError extends Error {
  constructor(message = 'You are not a collaborator on this list.') {
    super(message);
    this.name = 'NotCollaboratorError';
  }
}

export class OwnerCannotLeaveError extends Error {
  constructor(
    message = 'As the owner, you must transfer ownership before leaving or delete the list.',
  ) {
    super(message);
    this.name = 'OwnerCannotLeaveError';
  }
}

// ─── removeCollaborator — owner-only (AUDIT 1.4) ─────────────────────────

/**
 * Remove a collaborator from a list. Only the verified list owner may do this.
 * Idempotent w.r.t. `arrayRemove` — removing someone already not in the array
 * is a no-op at the storage level.
 */
export async function removeCollaborator(
  callerUid: string,
  listOwnerId: string,
  listId: string,
  collaboratorId: string,
): Promise<void> {
  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new ListNotFoundError();

  // AUDIT 1.4: compare the STORED owner against the verified caller, not
  // against any client-supplied param.
  if (listDoc.data()?.ownerId !== callerUid) {
    throw new NotListOwnerError('remove collaborators from');
  }

  await listRef.update({
    collaboratorIds: FieldValue.arrayRemove(collaboratorId),
    updatedAt: FieldValue.serverTimestamp(),
  });
  invalidateListMembers(listOwnerId, listId);
  invalidateCollaborativeLists(collaboratorId);
}

// ─── leaveList — collaborator self-removal ────────────────────────────────

/**
 * Caller removes themselves from a list's collaborator set. Owners are not
 * allowed (they must transfer ownership first to avoid an orphaned list).
 */
export async function leaveList(
  callerUid: string,
  listOwnerId: string,
  listId: string,
): Promise<void> {
  if (callerUid === listOwnerId) throw new OwnerCannotLeaveError();

  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new ListNotFoundError();

  const collaboratorIds: string[] = listDoc.data()?.collaboratorIds || [];
  if (!collaboratorIds.includes(callerUid)) {
    throw new NotCollaboratorError();
  }

  await listRef.update({
    collaboratorIds: FieldValue.arrayRemove(callerUid),
    updatedAt: FieldValue.serverTimestamp(),
  });
  invalidateListMembers(listOwnerId, listId);
  invalidateCollaborativeLists(callerUid);
}
