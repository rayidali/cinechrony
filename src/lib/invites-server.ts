/**
 * Invite-domain server logic — Phase A PR #5.
 *
 * Pure server-side module (no `'use server'`). Functions take an already-
 * verified caller uid; the route wrapper does the auth check. Errors are
 * thrown as typed classes so the route maps them to the right HTTP status.
 *
 * Closes:
 *   - AUDIT.md 1.11 — `acceptInvite` runs as a single Firestore transaction
 *     that re-reads invite status + member-cap atomically. Two concurrent
 *     accepts cannot blow past `MAX_LIST_MEMBERS`; a concurrent revoke
 *     cannot be ignored.
 *   - AUDIT.md 1.12 — `revokeInvite` accepts owner-OR-inviter; the status
 *     re-check + write happen inside the transaction.
 *   - AUDIT.md 1.14 — `getListPendingInvites` enforces membership server-side
 *     and only the OWNER gets `inviteCode` back (a removed collaborator can't
 *     walk away with a working join code).
 *   - AUDIT.md 2.9 — invite codes are CSPRNG (`crypto.randomInt`, no modulo
 *     bias), 12 chars from a hand-picked confusable-free alphabet; `getInviteByCode`
 *     requires auth at the route layer to prevent unauthenticated enumeration.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';
import { getDb } from '@/firebase/admin';
import { MAX_LIST_MEMBERS, invalidateCollaborativeLists, invalidateListMembers } from '@/lib/lists-server';
import { isBlockedBetween } from '@/lib/blocks-server';
import { sendPushToUser } from '@/lib/push-server';
import type { ListInvite } from '@/lib/types';

// ─── Typed errors → route maps to HTTP status ─────────────────────────────

export class InviteNotFoundError extends Error {
  constructor(message = 'Invite not found or has expired.') {
    super(message);
    this.name = 'InviteNotFoundError';
  }
}

export class InviteExpiredError extends Error {
  constructor(message = 'This invite link has expired.') {
    super(message);
    this.name = 'InviteExpiredError';
  }
}

export class InviteNotPendingError extends Error {
  constructor(message = 'This invite is no longer pending.') {
    super(message);
    this.name = 'InviteNotPendingError';
  }
}

export class NotInviteRecipientError extends Error {
  constructor(message = 'This invite is for another user.') {
    super(message);
    this.name = 'NotInviteRecipientError';
  }
}

export class NotInviteAuthorizedError extends Error {
  constructor(message = 'Only the list owner or the inviter can revoke this invite.') {
    super(message);
    this.name = 'NotInviteAuthorizedError';
  }
}

export class NotListMemberError extends Error {
  constructor(message = 'Only list members can perform this action.') {
    super(message);
    this.name = 'NotListMemberError';
  }
}

export class AlreadyCollaboratorError extends Error {
  constructor(message = 'User is already a collaborator on this list.') {
    super(message);
    this.name = 'AlreadyCollaboratorError';
  }
}

export class AlreadyInvitedError extends Error {
  constructor(message = 'An invite is already pending for this user.') {
    super(message);
    this.name = 'AlreadyInvitedError';
  }
}

export class MemberCapReachedError extends Error {
  constructor(message = `This list has reached the maximum number of members.`) {
    super(message);
    this.name = 'MemberCapReachedError';
  }
}

export class InviteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteValidationError';
  }
}

export class InviteeNotFoundError extends Error {
  constructor(message = 'User not found.') {
    super(message);
    this.name = 'InviteeNotFoundError';
  }
}

// ─── generateInviteCode — CSPRNG, no modulo bias (AUDIT 2.9) ──────────────

/**
 * A 12-character code from a confusable-free alphabet. Uses `crypto.randomInt`
 * which is cryptographically secure AND rejection-samples internally — no
 * `Math.random()`, no `% chars.length` bias.
 *
 * 54^12 ≈ 1.8e21 possibilities. Brute force against a status='pending'
 * filter is infeasible even at the database level.
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

// ─── Serialization helper ─────────────────────────────────────────────────

type InviteDocLike = FirebaseFirestore.DocumentData & {
  listId?: string;
  listName?: string;
  listOwnerId?: string;
  inviterId?: string;
  inviterUsername?: string | null;
  inviteeId?: string;
  inviteeUsername?: string | null;
  inviteCode?: string;
  status?: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt?: FirebaseFirestore.Timestamp;
  expiresAt?: FirebaseFirestore.Timestamp;
};

function serializeInvite(
  id: string,
  data: InviteDocLike,
  opts: { includeCode: boolean } = { includeCode: false },
): ListInvite {
  return {
    id,
    listId: data.listId!,
    listName: data.listName ?? 'Untitled List',
    listOwnerId: data.listOwnerId!,
    inviterId: data.inviterId!,
    inviterUsername: data.inviterUsername ?? null,
    inviteeId: data.inviteeId,
    inviteeUsername: data.inviteeUsername,
    inviteCode: opts.includeCode ? data.inviteCode : undefined,
    status: data.status ?? 'pending',
    createdAt:
      (data.createdAt?.toDate?.() ?? new Date()).toISOString() as unknown as Date,
    expiresAt: data.expiresAt
      ? (data.expiresAt.toDate().toISOString() as unknown as Date)
      : undefined,
  } as ListInvite;
}

// ─── inviteToList — direct invite to a specific user ──────────────────────

/**
 * Send a direct in-app invite from `inviterUid` to `inviteeId` for the list
 * at `users/{listOwnerId}/lists/{listId}`. Caller must be owner or
 * collaborator. The legacy action also created a `list_invite` notification
 * for the invitee (respecting their notification prefs) — preserved here.
 *
 * Returns the new invite id. Throws typed errors for permission / cap /
 * duplicate / not-found cases so the route can map them to HTTP status.
 */
export async function inviteToList(
  inviterUid: string,
  listOwnerId: string,
  listId: string,
  inviteeId: string,
): Promise<{ inviteId: string }> {
  if (!inviteeId || typeof inviteeId !== 'string') {
    throw new InviteValidationError('inviteeId is required.');
  }
  if (inviteeId === inviterUid) {
    throw new InviteValidationError("You can't invite yourself.");
  }

  const db = getDb();

  const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new NotListMemberError('List not found.');

  const listData = listDoc.data();
  const collaboratorIds: string[] = listData?.collaboratorIds || [];
  const isOwner = inviterUid === listOwnerId;
  const isCollab = collaboratorIds.includes(inviterUid);
  if (!isOwner && !isCollab) {
    throw new NotListMemberError('Only list members can invite collaborators.');
  }

  // Owner + collaborators counts toward MAX_LIST_MEMBERS; an invite that
  // would push past the cap if accepted is rejected up front.
  if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
    throw new MemberCapReachedError(
      `Lists can have a maximum of ${MAX_LIST_MEMBERS} members.`,
    );
  }

  if (collaboratorIds.includes(inviteeId) || inviteeId === listOwnerId) {
    throw new AlreadyCollaboratorError();
  }

  const inviteeDoc = await db.collection('users').doc(inviteeId).get();
  if (!inviteeDoc.exists) throw new InviteeNotFoundError();

  // A blocked pair can't invite each other. Same error as not-found so the
  // response is no existence-oracle for the block itself.
  if (await isBlockedBetween(db, inviterUid, inviteeId)) {
    throw new InviteeNotFoundError();
  }

  const existing = await db
    .collection('invites')
    .where('listId', '==', listId)
    .where('listOwnerId', '==', listOwnerId)
    .where('inviteeId', '==', inviteeId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!existing.empty) throw new AlreadyInvitedError();

  const inviterDoc = await db.collection('users').doc(inviterUid).get();
  const inviterData = inviterDoc.data();
  const inviteeData = inviteeDoc.data();

  const inviteRef = db.collection('invites').doc();
  await inviteRef.set({
    id: inviteRef.id,
    listId,
    listName: listData?.name || 'Untitled List',
    listOwnerId,
    inviterId: inviterUid,
    inviterUsername: inviterData?.username || null,
    inviteeId,
    inviteeUsername: inviteeData?.username || null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });

  // Best-effort list_invite notification. Respects the invitee's
  // notificationPreferences.listInvites (defaults true). Notification failure
  // does not roll back the invite.
  try {
    const prefs = inviteeData?.notificationPreferences;
    if (!prefs || prefs.listInvites !== false) {
      const listName = listData?.name || 'Untitled List';
      await db.collection('notifications').add({
        userId: inviteeId,
        type: 'list_invite',
        fromUserId: inviterUid,
        fromUsername: inviterData?.username || null,
        fromDisplayName: inviterData?.displayName || null,
        fromPhotoUrl: inviterData?.photoURL || null,
        listId,
        listOwnerId,
        listName,
        inviteId: inviteRef.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      const inviterName = inviterData?.username
        ? `@${inviterData.username}`
        : inviterData?.displayName || 'Someone';
      void sendPushToUser(inviteeId, {
        title: `${inviterName} invited you`,
        body: `to "${listName}"`,
        data: {
          type: 'list_invite',
          inviteId: inviteRef.id,
          listId,
          listOwnerId,
          // accept/decline live on the notifications page — land there.
          url: '/notifications',
        },
      }).catch((err) => console.error('[inviteToList] push failed:', err));
    }
  } catch (err) {
    console.error('[inviteToList] notification create failed:', err);
  }

  return { inviteId: inviteRef.id };
}

// ─── createInviteLink — generates a CSPRNG join code ──────────────────────

const INVITE_LINK_TTL_DAYS = 7;

export async function createInviteLink(
  inviterUid: string,
  listOwnerId: string,
  listId: string,
): Promise<{ inviteId: string; inviteCode: string; expiresAt: string }> {
  const db = getDb();
  const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
  const listDoc = await listRef.get();
  if (!listDoc.exists) throw new NotListMemberError('List not found.');

  const listData = listDoc.data();
  const collaboratorIds: string[] = listData?.collaboratorIds || [];
  const isOwner = inviterUid === listOwnerId;
  const isCollab = collaboratorIds.includes(inviterUid);
  if (!isOwner && !isCollab) {
    throw new NotListMemberError('Only list members can create invite links.');
  }

  if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
    throw new MemberCapReachedError(
      `Lists can have a maximum of ${MAX_LIST_MEMBERS} members.`,
    );
  }

  const inviterDoc = await db.collection('users').doc(inviterUid).get();
  const inviterData = inviterDoc.data();

  const inviteRef = db.collection('invites').doc();
  const inviteCode = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);

  await inviteRef.set({
    id: inviteRef.id,
    listId,
    listName: listData?.name || 'Untitled List',
    listOwnerId,
    inviterId: inviterUid,
    inviterUsername: inviterData?.username || null,
    inviteCode,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  return { inviteId: inviteRef.id, inviteCode, expiresAt: expiresAt.toISOString() };
}

// ─── getInviteByCode — auth required at the route layer (AUDIT 2.9) ──────

/**
 * Look up an invite by its link code. Returns the invite payload (including
 * the listOwnerId/listId so the client can show a preview before accepting).
 *
 * AUDIT 2.9: the route layer enforces auth before invoking this. With
 * `crypto.randomInt`-derived 12-char codes over a 54-char alphabet the search
 * space is ~1.8e21 — but the route auth gate raises the bar from "anyone on
 * the internet" to "any authenticated user," which is the right gate for
 * what a code-share is.
 */
export async function getInviteByCode(inviteCode: string): Promise<ListInvite> {
  if (!inviteCode || typeof inviteCode !== 'string') {
    throw new InviteValidationError('inviteCode is required.');
  }
  const db = getDb();
  const snap = await db
    .collection('invites')
    .where('inviteCode', '==', inviteCode)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (snap.empty) throw new InviteNotFoundError();

  const doc = snap.docs[0];
  const data = doc.data();
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
    throw new InviteExpiredError();
  }
  return serializeInvite(doc.id, data, { includeCode: true });
}

// ─── getMyPendingInvites — verified caller only ──────────────────────────

/**
 * Returns the verified caller's pending invites. The legacy action took a
 * client-supplied userId — this version derives it from the Bearer token,
 * closing the IDOR vector.
 */
export async function getMyPendingInvites(userUid: string): Promise<ListInvite[]> {
  const db = getDb();
  const snap = await db
    .collection('invites')
    .where('inviteeId', '==', userUid)
    .where('status', '==', 'pending')
    .get();
  return snap.docs.map((d) => serializeInvite(d.id, d.data(), { includeCode: false }));
}

// ─── getListPendingInvites — member-only, owner sees inviteCode (1.14) ───

export async function getListPendingInvites(
  callerUid: string,
  listOwnerId: string,
  listId: string,
): Promise<ListInvite[]> {
  const db = getDb();
  const listDoc = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .get();
  if (!listDoc.exists) throw new NotListMemberError('List not found.');

  const listData = listDoc.data();
  const collaboratorIds: string[] = listData?.collaboratorIds || [];
  const isOwner = callerUid === listOwnerId;
  const isCollab = collaboratorIds.includes(callerUid);
  if (!isOwner && !isCollab) {
    throw new NotListMemberError('Only list members can view pending invites.');
  }

  const snap = await db
    .collection('invites')
    .where('listId', '==', listId)
    .where('listOwnerId', '==', listOwnerId)
    .where('status', '==', 'pending')
    .get();
  return snap.docs.map((d) => serializeInvite(d.id, d.data(), { includeCode: isOwner }));
}

// ─── acceptInvite — transactional (AUDIT 1.11) ────────────────────────────

/**
 * Accept either by inviteId (from a `list_invite` notification or the user's
 * own pending list) or by inviteCode (from a shared link). Single Firestore
 * transaction: re-read invite status + list member count + write together.
 *
 * Side effect: deletes the corresponding `list_invite` notification for the
 * accepting user (best-effort, post-tx).
 */
export async function acceptInvite(
  callerUid: string,
  opts: { inviteId?: string; inviteCode?: string },
): Promise<{ listId: string; listOwnerId: string }> {
  const db = getDb();

  let inviteRef: FirebaseFirestore.DocumentReference;
  if (opts.inviteId) {
    inviteRef = db.collection('invites').doc(opts.inviteId);
  } else if (opts.inviteCode) {
    const snap = await db
      .collection('invites')
      .where('inviteCode', '==', opts.inviteCode)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (snap.empty) throw new InviteNotFoundError();
    inviteRef = snap.docs[0].ref;
  } else {
    throw new InviteValidationError('inviteId or inviteCode is required.');
  }

  type TxOk = {
    kind: 'ok';
    listId: string;
    listOwnerId: string;
    inviterId: string | null;
    listName: string;
  };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) return { kind: 'err' as const, error: new InviteNotFoundError() };
    const data = inviteSnap.data()!;

    if (data.inviteeId && data.inviteeId !== callerUid) {
      return { kind: 'err' as const, error: new NotInviteRecipientError() };
    }
    if (data.status !== 'pending') {
      return { kind: 'err' as const, error: new InviteNotPendingError('This invite is no longer valid.') };
    }
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      return { kind: 'err' as const, error: new InviteExpiredError('This invite has expired.') };
    }

    const listRef = db
      .collection('users').doc(data.listOwnerId)
      .collection('lists').doc(data.listId);
    const listSnap = await tx.get(listRef);
    if (!listSnap.exists) {
      return { kind: 'err' as const, error: new InviteNotFoundError('List no longer exists.') };
    }

    const collaboratorIds: string[] = listSnap.data()?.collaboratorIds || [];
    if (collaboratorIds.includes(callerUid) || callerUid === data.listOwnerId) {
      // Idempotent: marks invite accepted so it stops appearing as pending.
      tx.update(inviteRef, { status: 'accepted' });
      return { kind: 'err' as const, error: new AlreadyCollaboratorError('You are already a member of this list.') };
    }
    if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
      return { kind: 'err' as const, error: new MemberCapReachedError() };
    }

    tx.update(listRef, {
      collaboratorIds: FieldValue.arrayUnion(callerUid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviteRef, { status: 'accepted', inviteeId: callerUid });

    return {
      kind: 'ok' as const,
      listId: data.listId,
      listOwnerId: data.listOwnerId,
      inviterId: data.inviterId ?? null,
      listName: data.listName ?? 'Untitled List',
    };
  });

  if (result.kind === 'err') throw result.error;

  // The caller just joined — clear the caches so the list + its members show
  // immediately (same-instance; the TTL backstops cross-instance).
  invalidateCollaborativeLists(callerUid);
  invalidateListMembers(result.listOwnerId, result.listId);

  // Best-effort: delete the matching list_invite notification for this user.
  try {
    const notifSnap = await db
      .collection('notifications')
      .where('userId', '==', callerUid)
      .where('type', '==', 'list_invite')
      .where('listId', '==', result.listId)
      .limit(1)
      .get();
    if (!notifSnap.empty) {
      await notifSnap.docs[0].ref.delete();
    }
  } catch (err) {
    console.error('[acceptInvite] notification cleanup failed:', err);
  }

  // Close the loop: tell the inviter their invite was accepted. This is the
  // one membership event worth a ping besides the invite itself — declines
  // stay silent on purpose. Best-effort; rides the inviter's listInvites pref.
  if (result.inviterId && result.inviterId !== callerUid) {
    try {
      const [accepterDoc, inviterDoc] = await Promise.all([
        db.collection('users').doc(callerUid).get(),
        db.collection('users').doc(result.inviterId).get(),
      ]);
      const accepter = accepterDoc.data();
      const prefs = inviterDoc.data()?.notificationPreferences;
      if (!prefs || prefs.listInvites !== false) {
        await db.collection('notifications').add({
          userId: result.inviterId,
          type: 'invite_accepted',
          fromUserId: callerUid,
          fromUsername: accepter?.username || null,
          fromDisplayName: accepter?.displayName || null,
          fromPhotoUrl: accepter?.photoURL || null,
          listId: result.listId,
          listOwnerId: result.listOwnerId,
          listName: result.listName,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });

        const accepterName = accepter?.username
          ? `@${accepter.username}`
          : accepter?.displayName || 'someone';
        void sendPushToUser(result.inviterId, {
          title: `${accepterName} joined`,
          body: `"${result.listName}"`,
          data: {
            type: 'invite_accepted',
            listId: result.listId,
            listOwnerId: result.listOwnerId,
            url: `/lists/${result.listId}?owner=${result.listOwnerId}`,
          },
        }).catch((err) => console.error('[acceptInvite] push failed:', err));
      }
    } catch (err) {
      console.error('[acceptInvite] accepted-notification failed:', err);
    }
  }

  return { listId: result.listId, listOwnerId: result.listOwnerId };
}

// ─── declineInvite ───────────────────────────────────────────────────────

export async function declineInvite(
  callerUid: string,
  inviteId: string,
): Promise<void> {
  const db = getDb();
  const inviteRef = db.collection('invites').doc(inviteId);
  const inviteDoc = await inviteRef.get();
  if (!inviteDoc.exists) throw new InviteNotFoundError();

  const data = inviteDoc.data()!;
  if (data.inviteeId !== callerUid) throw new NotInviteRecipientError();

  await inviteRef.update({ status: 'declined' });

  // Best-effort notification cleanup.
  try {
    const notifSnap = await db
      .collection('notifications')
      .where('userId', '==', callerUid)
      .where('type', '==', 'list_invite')
      .where('listId', '==', data.listId)
      .limit(1)
      .get();
    if (!notifSnap.empty) {
      await notifSnap.docs[0].ref.delete();
    }
  } catch (err) {
    console.error('[declineInvite] notification cleanup failed:', err);
  }
}

// ─── revokeInvite — owner OR inviter (AUDIT 1.12) ────────────────────────

export async function revokeInvite(callerUid: string, inviteId: string): Promise<void> {
  const db = getDb();
  const inviteRef = db.collection('invites').doc(inviteId);

  type TxOk = { kind: 'ok' };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) return { kind: 'err' as const, error: new InviteNotFoundError() };
    const data = inviteSnap.data()!;

    // 1.12: owner OR inviter can revoke.
    if (data.inviterId !== callerUid && data.listOwnerId !== callerUid) {
      return { kind: 'err' as const, error: new NotInviteAuthorizedError() };
    }
    // Don't revoke an invite that was just accepted (or already declined).
    if (data.status !== 'pending') {
      return { kind: 'err' as const, error: new InviteNotPendingError() };
    }

    tx.update(inviteRef, { status: 'revoked' });
    return { kind: 'ok' as const };
  });

  if (result.kind === 'err') throw result.error;
}
