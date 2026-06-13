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
import type { ListMember } from '@/lib/types';

const BATCH_LIMIT = 450; // Firestore allows 500/batch; leave headroom.

/** Owner + 9 collaborators. Used by invites + collaborators routes. */
export const MAX_LIST_MEMBERS = 10;

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

// ─── List likes (Phase A PR #9, LAUNCH 0.5.1) ─────────────────────────────

export class ListNotPublicError extends Error {
  constructor(message = 'Only public lists can be liked.') {
    super(message);
    this.name = 'ListNotPublicError';
  }
}

export class CannotLikeOwnListError extends Error {
  constructor(message = "You can't like a list you're part of.") {
    super(message);
    this.name = 'CannotLikeOwnListError';
  }
}

export class ListAlreadyLikedError extends Error {
  constructor(message = 'Already liked.') {
    super(message);
    this.name = 'ListAlreadyLikedError';
  }
}

export class ListNotLikedError extends Error {
  constructor(message = 'Not liked yet.') {
    super(message);
    this.name = 'ListNotLikedError';
  }
}

/**
 * Like a public list (LAUNCH 0.5.1). Read-check-write inside a transaction
 * matches the AUDIT 3.5 pattern. `likes`/`likedBy`/`lastLikedAt` are
 * server-only fields — `firestore.rules` blocks the owner from editing
 * them, so counts can't be forged client-side.
 *
 * Members (owner + collaborators) cannot like their own list — keeps the
 * loved-lists showcase from being gamed by the team itself.
 *
 * Best-effort `list_like` notification to the owner post-commit.
 */
export async function likeList(
  callerUid: string,
  listOwnerId: string,
  listId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);

  type TxOk = {
    kind: 'ok';
    listData: FirebaseFirestore.DocumentData;
    newLikes: number;
  };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(listRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ListNotFoundError() };
    const data = snap.data() || {};
    if (data.isPublic !== true) {
      return { kind: 'err' as const, error: new ListNotPublicError() };
    }
    const collaboratorIds: string[] = data.collaboratorIds || [];
    if (listOwnerId === callerUid || collaboratorIds.includes(callerUid)) {
      return { kind: 'err' as const, error: new CannotLikeOwnListError() };
    }
    const likedBy: string[] = data.likedBy || [];
    if (likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new ListAlreadyLikedError() };
    }
    tx.update(listRef, {
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(callerUid),
      lastLikedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'ok' as const, listData: data, newLikes: (data.likes || 0) + 1 };
  });
  if (result.kind === 'err') throw result.error;

  // Notify the owner — best-effort, never self.
  if (listOwnerId !== callerUid) {
    try {
      const ownerDoc = await db.collection('users').doc(listOwnerId).get();
      const prefs = ownerDoc.data()?.notificationPreferences;
      if (!prefs || prefs.likes !== false) {
        const likerDoc = await db.collection('users').doc(callerUid).get();
        const likerData = likerDoc.data();
        await db.collection('notifications').add({
          userId: listOwnerId,
          type: 'list_like',
          fromUserId: callerUid,
          fromUsername: likerData?.username || null,
          fromDisplayName: likerData?.displayName || null,
          fromPhotoUrl: likerData?.photoURL || null,
          listId,
          listOwnerId,
          listName: result.listData?.name || 'your list',
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('[likeList] notification create failed:', err);
    }
  }

  return { likes: result.newLikes };
}

/**
 * Unlike a public list. `lastLikedAt` is intentionally NOT touched —
 * unliking is not "activity" that should refresh the recency signal that
 * powers the loved-lists showcase.
 */
export async function unlikeList(
  callerUid: string,
  listOwnerId: string,
  listId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(listRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ListNotFoundError() };
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (!likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new ListNotLikedError() };
    }
    tx.update(listRef, {
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(callerUid),
    });
    return { kind: 'ok' as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}

// ═════════════════════════════════════════════════════════════════════════
// READ SURFACE (Phase A PR #18)
// ═════════════════════════════════════════════════════════════════════════

// ─── Shared types ────────────────────────────────────────────────────────

export type LovedListCard = {
  id: string;
  name: string;
  ownerId: string;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  coverImageUrl: string;
  /** v3: when 'auto', render the mosaic even if coverImageUrl is set. */
  coverMode: 'auto' | 'custom' | null;
  movieCount: number;
  likes: number;
  previewPosters: string[];
};

// ─── Internal: hydrateListCards ──────────────────────────────────────────

/**
 * Turn raw list docs into discovery cards — batch-fetches owner profiles
 * and up to 4 preview posters per list. Shared by getLovedLists +
 * searchPublicLists.
 */
async function hydrateListCards(
  db: FirebaseFirestore.Firestore,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<LovedListCard[]> {
  const ownerIds = [...new Set(docs.map((d) => d.data().ownerId).filter(Boolean))];
  const ownerDocs = ownerIds.length
    ? await db.getAll(...ownerIds.map((id) => db.collection('users').doc(id)))
    : [];
  const ownerById = new Map(ownerDocs.map((s) => [s.id, s.data()]));

  return Promise.all(
    docs.map(async (doc) => {
      const d = doc.data();
      const ownerId: string = d.ownerId;
      const owner = ownerById.get(ownerId);
      const moviesSnap = await db
        .collection('users').doc(ownerId)
        .collection('lists').doc(doc.id)
        .collection('movies')
        .orderBy('createdAt', 'desc')
        .limit(4)
        .get();
      const previewPosters: string[] = [];
      moviesSnap.forEach((m) => {
        const p = m.data().posterUrl;
        if (typeof p === 'string' && p) previewPosters.push(p);
      });
      return {
        id: doc.id,
        name: d.name || 'untitled list',
        ownerId,
        ownerUsername: owner?.username || null,
        ownerDisplayName: owner?.displayName || null,
        coverImageUrl: d.coverImageUrl || '',
        coverMode: (d.coverMode as 'auto' | 'custom' | undefined) ?? null,
        movieCount: typeof d.movieCount === 'number' ? d.movieCount : previewPosters.length,
        likes: d.likes || 0,
        previewPosters,
      };
    }),
  );
}

// ─── getLovedLists (LAUNCH 0.5.2 — recency-weighted discovery) ──────────

/**
 * Editorial loved-lists showcase. Collection-group query, candidate set
 * ordered by raw `likes`, then re-ranked in memory by a recency-weighted
 * "hot" score so a list that camped the top months ago can't ossify.
 * Cold-start gated: returns `{ lists: [], gated: true }` until at least
 * MIN_LOVED_LISTS public lists have been liked.
 */
export async function getLovedLists(limit = 12): Promise<{ lists: LovedListCard[]; gated: boolean }> {
  const MIN_LOVED_LISTS = 3;
  const db = getDb();
  const snap = await db
    .collectionGroup('lists')
    .where('isPublic', '==', true)
    .where('likes', '>', 0)
    .orderBy('likes', 'desc')
    .limit(60)
    .get();

  if (snap.size < MIN_LOVED_LISTS) {
    return { lists: [], gated: true };
  }

  const now = Date.now();
  const ranked = snap.docs
    .map((doc) => {
      const d = doc.data();
      const likes: number = d.likes || 0;
      const lastMs = d.lastLikedAt?.toMillis?.() ?? d.createdAt?.toMillis?.() ?? now;
      const ageHours = Math.max(0, (now - lastMs) / 3_600_000);
      return { doc, score: likes / Math.pow(ageHours + 2, 1.5) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);

  const lists = await hydrateListCards(db, ranked);
  return { lists, gated: false };
}

// ─── searchPublicLists (LAUNCH 0.5.3 — Home search overlay) ─────────────

/**
 * In-memory substring match over the public-list collection group. Fine
 * while the dataset is small (per LAUNCH plan); swap to a `nameLower`
 * prefix index if list volume grows.
 */
export async function searchPublicLists(query: string, limit = 12): Promise<{ lists: LovedListCard[] }> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { lists: [] };
  const db = getDb();
  const snap = await db
    .collectionGroup('lists')
    .where('isPublic', '==', true)
    .limit(150)
    .get();
  const matches = snap.docs
    .filter((doc) => String(doc.data().name || '').toLowerCase().includes(q))
    .sort((a, b) => (b.data().likes || 0) - (a.data().likes || 0))
    .slice(0, limit);
  const lists = await hydrateListCards(db, matches);
  return { lists };
}

// ─── getUserLists / getCollaborativeLists / getUserPublicLists ──────────

export type ListSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  isPublic: boolean;
  ownerId: string;
  collaboratorIds: string[];
  coverImageUrl: string | null;
  movieCount: number;
  likes?: number;
  likedBy?: string[];
  createdAt: string;
  updatedAt: string;
};

export async function getUserLists(userId: string): Promise<{ lists: ListSummary[] }> {
  const db = getDb();
  const listsSnapshot = await db
    .collection('users').doc(userId).collection('lists')
    .orderBy('createdAt', 'desc')
    .get();

  const lists = listsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      isDefault: data.isDefault || false,
      isPublic: data.isPublic || false,
      ownerId: userId,
      collaboratorIds: data.collaboratorIds || [],
      coverImageUrl: data.coverImageUrl || null,
      movieCount: data.movieCount || 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    };
  });
  return { lists };
}

export async function getUserPublicLists(userId: string): Promise<{ lists: ListSummary[] }> {
  const db = getDb();
  const listsSnapshot = await db
    .collection('users').doc(userId).collection('lists')
    .where('isPublic', '==', true)
    .get();

  const lists = listsSnapshot.docs.map((doc) => {
    const data = doc.data();
    const updatedAtMs = data.updatedAt?.toDate?.()?.getTime?.() || 0;
    return {
      id: doc.id,
      name: data.name,
      isDefault: data.isDefault || false,
      isPublic: data.isPublic || false,
      ownerId: data.ownerId,
      collaboratorIds: data.collaboratorIds || [],
      coverImageUrl: data.coverImageUrl || null,
      movieCount: data.movieCount || 0,
      likes: data.likes || 0,
      likedBy: data.likedBy || [],
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      _sortTime: updatedAtMs,
    };
  });
  lists.sort((a, b) => b._sortTime - a._sortTime);
  return { lists: lists.map(({ _sortTime: _, ...rest }) => rest) };
}

export type CollaborativeListSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  isPublic: boolean;
  isDefault: boolean;
  collaboratorIds: string[];
  coverImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getCollaborativeLists(userId: string): Promise<{ lists: CollaborativeListSummary[] }> {
  const db = getDb();
  const acceptedInvites = await db.collection('invites')
    .where('inviteeId', '==', userId)
    .where('status', '==', 'accepted')
    .get();

  const listPromises = acceptedInvites.docs.map(async (inviteDoc) => {
    const inviteData = inviteDoc.data();
    const listDoc = await db
      .collection('users').doc(inviteData.listOwnerId)
      .collection('lists').doc(inviteData.listId)
      .get();
    if (!listDoc.exists) return null;
    const listData = listDoc.data();
    if (!listData?.collaboratorIds?.includes(userId)) return null;
    return {
      id: listDoc.id,
      name: listData.name,
      ownerId: inviteData.listOwnerId,
      ownerUsername: inviteData.inviterUsername || null,
      ownerDisplayName: inviteData.inviterDisplayName || inviteData.inviterUsername || null,
      isPublic: listData.isPublic || false,
      isDefault: listData.isDefault || false,
      collaboratorIds: listData.collaboratorIds || [],
      coverImageUrl: listData.coverImageUrl || null,
      createdAt: listData.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      updatedAt: listData.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    };
  });
  const results = await Promise.all(listPromises);
  return { lists: results.filter((l): l is CollaborativeListSummary => l !== null) };
}

// ─── getListMembers ──────────────────────────────────────────────────────

export async function getListMembers(
  listOwnerId: string,
  listId: string,
): Promise<{ members: ListMember[] }> {
  const db = getDb();
  const listDoc = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .get();
  if (!listDoc.exists) throw new ListNotFoundError();

  const collaboratorIds: string[] = listDoc.data()?.collaboratorIds || [];
  const allUserIds = [listOwnerId, ...collaboratorIds];

  const userPromises = allUserIds.map(async (userId, index) => {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return null;
    const userData = userDoc.data();
    return {
      uid: userId,
      username: userData?.username || null,
      displayName: userData?.displayName || null,
      photoURL: userData?.photoURL || null,
      role: index === 0 ? 'owner' as const : 'collaborator' as const,
    };
  });

  const results = await Promise.all(userPromises);
  return { members: results.filter((m): m is ListMember => m !== null) };
}

// ─── getListPreview / getListsPreviews (AUDIT 1.13 — privacy gated) ─────

/**
 * Returns posters + count for a list, with privacy enforcement:
 * - public lists: open to any caller
 * - private lists: only owner or collaborator (by verified token uid).
 *   Returns an empty preview (no leak, no error) for anyone else.
 */
export async function getListPreview(
  listOwnerId: string,
  listId: string,
  viewerUid: string | null,
): Promise<{ previewPosters: string[]; movieCount: number }> {
  const db = getDb();
  const listSnap = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId).get();
  if (!listSnap.exists) return { previewPosters: [], movieCount: 0 };

  const listInfo = listSnap.data();
  if (listInfo?.isPublic !== true) {
    const collaboratorIds: string[] = listInfo?.collaboratorIds || [];
    const allowed = viewerUid != null &&
      (viewerUid === listOwnerId || collaboratorIds.includes(viewerUid));
    if (!allowed) return { previewPosters: [], movieCount: 0 };
  }

  const moviesSnap = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .collection('movies')
    .orderBy('createdAt', 'desc')
    .limit(4)
    .get();
  const previewPosters: string[] = [];
  moviesSnap.forEach((doc) => {
    const url = doc.data().posterUrl;
    if (typeof url === 'string' && url) previewPosters.push(url);
  });

  const countSnap = await db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .collection('movies').count().get();

  return { previewPosters, movieCount: countSnap.data().count };
}

export async function getListsPreviews(
  listOwnerId: string,
  listIds: string[],
  viewerUid: string | null,
): Promise<{ previews: Record<string, { previewPosters: string[]; movieCount: number }> }> {
  const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};
  const results = await Promise.all(
    listIds.map(async (listId) => {
      const r = await getListPreview(listOwnerId, listId, viewerUid);
      return { listId, ...r };
    }),
  );
  results.forEach(({ listId, previewPosters, movieCount }) => {
    previews[listId] = { previewPosters, movieCount };
  });
  return { previews };
}

// ─── getPublicListMovies — single list w/ movies + role flag ────────────

export type PublicListResult = {
  list: {
    id: string;
    name: string;
    description: string;
    isDefault: boolean;
    isPublic: boolean;
    ownerId: string;
    collaboratorIds: string[];
    coverImageUrl: string;
    likes: number;
    likedBy: string[];
    createdAt: string;
    updatedAt: string;
  };
  movies: Array<Record<string, unknown>>;
  isCollaborator: boolean;
};

export class PrivateListError extends Error {
  constructor(message = 'This list is private.') {
    super(message);
    this.name = 'PrivateListError';
  }
}

export async function getPublicListMovies(
  ownerId: string,
  listId: string,
  viewerUid: string | null,
): Promise<PublicListResult> {
  const db = getDb();
  const listDoc = await db
    .collection('users').doc(ownerId)
    .collection('lists').doc(listId).get();
  if (!listDoc.exists) throw new ListNotFoundError();

  const listData = listDoc.data();
  const collaboratorIds: string[] = listData?.collaboratorIds || [];
  const isOwner = ownerId === viewerUid;
  const isCollaborator = viewerUid != null && collaboratorIds.includes(viewerUid);
  const isPublic = listData?.isPublic === true;

  if (!isPublic && !isOwner && !isCollaborator) throw new PrivateListError();

  const moviesSnapshot = await db
    .collection('users').doc(ownerId)
    .collection('lists').doc(listId)
    .collection('movies')
    .orderBy('createdAt', 'desc').get();

  const movies = moviesSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      year: data.year,
      posterUrl: data.posterUrl,
      posterHint: data.posterHint,
      addedBy: data.addedBy,
      socialLink: data.socialLink || '',
      status: data.status,
      tmdbId: data.tmdbId,
      overview: data.overview,
      rating: data.rating,
      backdropUrl: data.backdropUrl,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    };
  });

  return {
    list: {
      id: listDoc.id,
      name: listData?.name,
      description: listData?.description || '',
      isDefault: listData?.isDefault || false,
      isPublic: listData?.isPublic || false,
      ownerId: listData?.ownerId,
      collaboratorIds: listData?.collaboratorIds || [],
      coverImageUrl: listData?.coverImageUrl || '',
      likes: listData?.likes || 0,
      likedBy: listData?.likedBy || [],
      createdAt: listData?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      updatedAt: listData?.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
    },
    movies,
    isCollaborator: isCollaborator && !isOwner,
  };
}
