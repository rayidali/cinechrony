/**
 * Activity-feed write helper — Phase A PR #4 extraction.
 *
 * `createActivity` was previously a private helper inside `src/app/actions.ts`.
 * That file is `'use server'`, which means every exported function becomes a
 * Server Action — fine for callers from the client, hostile to internal
 * helpers that other server modules want to import. Extracted here so the
 * `/api/v1/lists/[ownerId]/[listId]/movies/...` routes (and future PR #8/#9
 * activity-emitters) can call it without dragging actions.ts into their
 * import graph.
 *
 * The behavior is unchanged — Firestore `activities` doc write with the
 * denormalized author profile attached. Errors are caught + logged here so
 * the caller doesn't have to wrap every emit in try/catch.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import type { Activity, ActivityType } from '@/lib/types';

// ─── Typed errors (Phase A PR #10) ────────────────────────────────────────

export class ActivityNotFoundError extends Error {
  constructor(message = 'Activity not found.') {
    super(message);
    this.name = 'ActivityNotFoundError';
  }
}

export class AlreadyLikedActivityError extends Error {
  constructor(message = 'Already liked.') {
    super(message);
    this.name = 'AlreadyLikedActivityError';
  }
}

export class NotLikedActivityError extends Error {
  constructor(message = 'Not liked yet.') {
    super(message);
    this.name = 'NotLikedActivityError';
  }
}

export type ActivityWrite = {
  userId: string;
  type: ActivityType;
  tmdbId: number;
  movieTitle: string;
  moviePosterUrl: string | null;
  movieYear: string;
  mediaType: 'movie' | 'tv';
  rating?: number;
  reviewText?: string;
  reviewId?: string;
  listId?: string;
  listName?: string;
};

export async function createActivity(
  db: FirebaseFirestore.Firestore,
  data: ActivityWrite,
): Promise<{ success: true; activityId: string } | { error: string }> {
  try {
    const userDoc = await db.collection('users').doc(data.userId).get();
    const userData = userDoc.data();

    const activityRef = db.collection('activities').doc();
    await activityRef.set({
      id: activityRef.id,
      userId: data.userId,
      username: userData?.username || null,
      displayName: userData?.displayName || null,
      photoURL: userData?.photoURL || null,
      type: data.type,
      tmdbId: data.tmdbId,
      movieTitle: data.movieTitle,
      moviePosterUrl: data.moviePosterUrl,
      movieYear: data.movieYear,
      mediaType: data.mediaType,
      rating: data.rating ?? null,
      reviewText: data.reviewText ?? null,
      reviewId: data.reviewId ?? null,
      listId: data.listId ?? null,
      listName: data.listName ?? null,
      likes: 0,
      likedBy: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, activityId: activityRef.id };
  } catch (error) {
    console.error('[createActivity] Failed:', error);
    return { error: 'Failed to create activity' };
  }
}

/**
 * Convenience wrapper that resolves the default `db`. Helper routes don't
 * need to pass `db` explicitly when they're a one-shot post-commit emit.
 */
export function emitActivity(data: ActivityWrite) {
  return createActivity(getDb(), data);
}

// ─── Doc → Activity serialization (Phase A PR #10) ────────────────────────

/** Map an `activities` collection doc to the Activity type. */
export function activityFromDoc(doc: FirebaseFirestore.DocumentSnapshot): Activity {
  const data = doc.data() || {};
  return {
    id: doc.id,
    userId: data.userId,
    username: data.username,
    displayName: data.displayName,
    photoURL: data.photoURL,
    type: data.type,
    tmdbId: data.tmdbId,
    movieTitle: data.movieTitle,
    moviePosterUrl: data.moviePosterUrl,
    movieYear: data.movieYear,
    mediaType: data.mediaType,
    rating: data.rating,
    reviewText: data.reviewText,
    reviewId: data.reviewId,
    listId: data.listId,
    listName: data.listName,
    likes: data.likes || 0,
    likedBy: data.likedBy || [],
    createdAt: data.createdAt?.toDate?.() || new Date(),
  };
}

// ─── getActivityFeed — cursor pagination ─────────────────────────────────

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

export async function getActivityFeed(opts: { limit?: number; cursor?: string } = {}): Promise<{
  activities: Activity[];
  hasMore: boolean;
  nextCursor?: string;
}> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE), MAX_PAGE);
  const db = getDb();

  let query: FirebaseFirestore.Query = db
    .collection('activities')
    .orderBy('createdAt', 'desc');

  if (opts.cursor) {
    const cursorDoc = await db.collection('activities').doc(opts.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  // Fetch one extra to determine hasMore.
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  return {
    activities: pageDocs.map(activityFromDoc),
    hasMore,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : undefined,
  };
}

// ─── likeActivity — transactional (AUDIT 3.5) ────────────────────────────

export async function likeActivity(
  callerUid: string,
  activityId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const activityRef = db.collection('activities').doc(activityId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(activityRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ActivityNotFoundError() };
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new AlreadyLikedActivityError() };
    }
    tx.update(activityRef, {
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(callerUid),
    });
    return { kind: 'ok' as const, newLikes: (data.likes || 0) + 1 };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}

// ─── unlikeActivity — transactional (AUDIT 3.5) ──────────────────────────

export async function unlikeActivity(
  callerUid: string,
  activityId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const activityRef = db.collection('activities').doc(activityId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(activityRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ActivityNotFoundError() };
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (!likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new NotLikedActivityError() };
    }
    tx.update(activityRef, {
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(callerUid),
    });
    return { kind: 'ok' as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}
