/**
 * Review-domain server logic — Phase A PR #8.
 *
 * Reviews are the unified `comment / reply / like` surface on a movie or
 * TV show. They live in the top-level `/reviews` collection (not nested
 * under the movie) because they're TMDB-indexed: many movies the app
 * surfaces are not stored locally.
 *
 * Closes / preserves:
 *   - AUDIT.md 2.6 — `updateReview` mutates the original doc (real edit;
 *     no duplicate review post on save).
 *   - AUDIT.md 3.5 — `likeReview`/`unlikeReview` wrap the check-then-act
 *     in `db.runTransaction`. Concurrent double-tap → exactly one
 *     increment + one likedBy entry. No drift.
 *   - AUDIT.md 3.8 — `createReview` + `likeReview` rate-limited at the
 *     route layer (preserved from the legacy actions).
 *   - AUDIT.md 3.10 — `getMovieReviews` + `getReviewReplies` accept an
 *     optional `cursor` (a Firestore doc id) and return `hasMore` +
 *     `nextCursor`. Matches the `getActivityFeed` pagination pattern.
 *
 * Threading: top-level reviews have `parentId === null`. Replies set
 * `parentId` to their PARENT's id (1-level only — no nested replies).
 * Creating a reply increments the parent's `replyCount`.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { emitActivity } from '@/lib/activities-server';
import {
  createMentionNotifications,
  createReplyNotification,
  createLikeNotification,
} from '@/lib/notifications-server';
import type { Review } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class ReviewNotFoundError extends Error {
  constructor(message = 'Review not found.') {
    super(message);
    this.name = 'ReviewNotFoundError';
  }
}

export class ReviewAuthorMismatchError extends Error {
  constructor(message = 'You can only modify your own reviews.') {
    super(message);
    this.name = 'ReviewAuthorMismatchError';
  }
}

export class AlreadyLikedError extends Error {
  constructor(message = 'Already liked.') {
    super(message);
    this.name = 'AlreadyLikedError';
  }
}

export class NotLikedError extends Error {
  constructor(message = 'Not liked yet.') {
    super(message);
    this.name = 'NotLikedError';
  }
}

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

export class UserNotFoundError extends Error {
  constructor(message = 'User not found.') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_REVIEW_LENGTH = 2000; // AUDIT.md 2.16 segment — sane upper bound
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

// ─── Serialization ────────────────────────────────────────────────────────

function reviewFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): Review {
  const data = doc.data();
  return {
    id: doc.id,
    tmdbId: data.tmdbId,
    mediaType: data.mediaType,
    movieTitle: data.movieTitle,
    moviePosterUrl: data.moviePosterUrl,
    userId: data.userId,
    username: data.username,
    userDisplayName: data.userDisplayName,
    userPhotoUrl: data.userPhotoUrl,
    text: data.text,
    ratingAtTime: data.ratingAtTime ?? null,
    likes: data.likes || 0,
    likedBy: data.likedBy || [],
    parentId: data.parentId ?? null,
    replyCount: data.replyCount || 0,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  } as Review;
}

// ─── createReview ─────────────────────────────────────────────────────────

export type CreateReviewInput = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  text: string;
  /** Snapshot of the caller's current rating at write time. If undefined,
   *  the helper looks it up. Pass `null` explicitly to skip. */
  ratingAtTime?: number | null;
  /** If set, this is a reply to the given parent review id. */
  parentId?: string | null;
  hasSpoiler?: boolean;
};

export async function createReview(
  callerUid: string,
  input: CreateReviewInput,
): Promise<{ review: Review }> {
  if (!input.text || typeof input.text !== 'string') {
    throw new ReviewValidationError('text is required.');
  }
  const text = input.text.trim();
  if (!text) {
    throw new ReviewValidationError('Review text cannot be empty.');
  }
  if (text.length > MAX_REVIEW_LENGTH) {
    throw new ReviewValidationError(`Review is too long (max ${MAX_REVIEW_LENGTH} chars).`);
  }

  const db = getDb();
  const userDoc = await db.collection('users').doc(callerUid).get();
  if (!userDoc.exists) throw new UserNotFoundError();
  const userData = userDoc.data();

  // Snapshot the caller's rating if not supplied.
  let rating = input.ratingAtTime;
  if (rating === undefined) {
    const ratingId = `${callerUid}_${input.tmdbId}`;
    const ratingDoc = await db.collection('ratings').doc(ratingId).get();
    rating = ratingDoc.exists ? (ratingDoc.data()?.rating ?? null) : null;
  }

  const reviewRef = db.collection('reviews').doc();
  const reviewData = {
    id: reviewRef.id,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    movieTitle: input.movieTitle,
    moviePosterUrl: input.moviePosterUrl || null,
    userId: callerUid,
    username: userData?.username || null,
    userDisplayName: userData?.displayName || null,
    userPhotoUrl: userData?.photoURL || null,
    text,
    ratingAtTime: rating,
    likes: 0,
    likedBy: [],
    parentId: input.parentId || null,
    replyCount: 0,
    hasSpoiler: !!input.hasSpoiler,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await reviewRef.set(reviewData);

  // Reply path: bump parent's replyCount + notify parent author.
  if (input.parentId) {
    const parentRef = db.collection('reviews').doc(input.parentId);
    const parentDoc = await parentRef.get();
    await parentRef.update({ replyCount: FieldValue.increment(1) });
    if (parentDoc.exists) {
      try {
        await createReplyNotification(db, {
          reviewId: reviewRef.id,
          reviewText: text,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          movieTitle: input.movieTitle,
          fromUserId: callerUid,
          fromUsername: userData?.username || null,
          fromDisplayName: userData?.displayName || null,
          fromPhotoUrl: userData?.photoURL || null,
          parentAuthorId: parentDoc.data()?.userId || '',
        });
      } catch (err) {
        console.error('[createReview] reply notification failed:', err);
      }
    }
  }

  // @-mention notifications (always, on top-level OR reply).
  try {
    await createMentionNotifications(db, {
      reviewId: reviewRef.id,
      reviewText: text,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      movieTitle: input.movieTitle,
      fromUserId: callerUid,
      fromUsername: userData?.username || null,
      fromDisplayName: userData?.displayName || null,
      fromPhotoUrl: userData?.photoURL || null,
    });
  } catch (err) {
    console.error('[createReview] mention notifications failed:', err);
  }

  // 'reviewed' activity for top-level only.
  if (!input.parentId) {
    try {
      await emitActivity({
        userId: callerUid,
        type: 'reviewed',
        tmdbId: input.tmdbId,
        movieTitle: input.movieTitle,
        moviePosterUrl: input.moviePosterUrl || null,
        movieYear: '',
        mediaType: input.mediaType,
        reviewText: text.substring(0, 200),
        reviewId: reviewRef.id,
      });
    } catch (err) {
      console.error('[createReview] activity emit failed:', err);
    }
  }

  return {
    review: {
      ...reviewData,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Review,
  };
}

// ─── getMovieReviews — top-level only, cursor pagination (AUDIT 3.10) ────

export type ListReviewsOpts = {
  sortBy?: 'recent' | 'likes';
  limit?: number;
  cursor?: string;
};

export async function getMovieReviews(
  tmdbId: number,
  opts: ListReviewsOpts = {},
): Promise<{ reviews: Review[]; hasMore: boolean; nextCursor?: string }> {
  const sortBy = opts.sortBy === 'likes' ? 'likes' : 'recent';
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE), MAX_PAGE);

  const db = getDb();
  let query: FirebaseFirestore.Query = db
    .collection('reviews')
    .where('tmdbId', '==', tmdbId)
    .where('parentId', '==', null);

  query = sortBy === 'likes'
    ? query.orderBy('likes', 'desc').orderBy('createdAt', 'desc')
    : query.orderBy('createdAt', 'desc');

  if (opts.cursor) {
    const cursorDoc = await db.collection('reviews').doc(opts.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  // Fetch one extra to determine hasMore.
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  return {
    reviews: pageDocs.map(reviewFromDoc),
    hasMore,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : undefined,
  };
}

// ─── getReviewReplies — chronological, cursor pagination (AUDIT 3.10) ────

export async function getReviewReplies(
  parentId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ replies: Review[]; hasMore: boolean; nextCursor?: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE), MAX_PAGE);

  const db = getDb();
  let query: FirebaseFirestore.Query = db
    .collection('reviews')
    .where('parentId', '==', parentId)
    .orderBy('createdAt', 'asc');

  if (opts.cursor) {
    const cursorDoc = await db.collection('reviews').doc(opts.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  return {
    replies: pageDocs.map(reviewFromDoc),
    hasMore,
    nextCursor: hasMore ? pageDocs[pageDocs.length - 1].id : undefined,
  };
}

// ─── updateReview — real edit, owner-only (AUDIT 2.6) ────────────────────

export async function updateReview(
  callerUid: string,
  reviewId: string,
  fields: { text?: string; hasSpoiler?: boolean },
): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (fields.text !== undefined) {
    if (typeof fields.text !== 'string') {
      throw new ReviewValidationError('text must be a string.');
    }
    const trimmed = fields.text.trim();
    if (!trimmed) throw new ReviewValidationError('Review text cannot be empty.');
    if (trimmed.length > MAX_REVIEW_LENGTH) {
      throw new ReviewValidationError(`Review is too long (max ${MAX_REVIEW_LENGTH} chars).`);
    }
    updates.text = trimmed;
  }

  if (fields.hasSpoiler !== undefined) {
    if (typeof fields.hasSpoiler !== 'boolean') {
      throw new ReviewValidationError('hasSpoiler must be a boolean.');
    }
    updates.hasSpoiler = fields.hasSpoiler;
  }

  if (Object.keys(updates).length === 0) {
    throw new ReviewValidationError('No updatable fields provided.');
  }
  updates.updatedAt = FieldValue.serverTimestamp();

  const db = getDb();
  const reviewRef = db.collection('reviews').doc(reviewId);
  const reviewDoc = await reviewRef.get();
  if (!reviewDoc.exists) throw new ReviewNotFoundError();
  if (reviewDoc.data()?.userId !== callerUid) {
    throw new ReviewAuthorMismatchError();
  }

  await reviewRef.update(updates);
}

// ─── deleteReview — owner-only ────────────────────────────────────────────

export async function deleteReview(
  callerUid: string,
  reviewId: string,
): Promise<void> {
  const db = getDb();
  const reviewRef = db.collection('reviews').doc(reviewId);
  const reviewDoc = await reviewRef.get();
  if (!reviewDoc.exists) throw new ReviewNotFoundError();
  if (reviewDoc.data()?.userId !== callerUid) {
    throw new ReviewAuthorMismatchError('You can only delete your own reviews.');
  }
  await reviewRef.delete();
}

// ─── likeReview — transactional (AUDIT 3.5) ──────────────────────────────

export async function likeReview(
  callerUid: string,
  reviewId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const reviewRef = db.collection('reviews').doc(reviewId);

  type TxOk = { kind: 'ok'; reviewData: FirebaseFirestore.DocumentData; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reviewRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ReviewNotFoundError() };
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new AlreadyLikedError() };
    }
    tx.update(reviewRef, {
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(callerUid),
    });
    return { kind: 'ok' as const, reviewData: data, newLikes: (data.likes || 0) + 1 };
  });
  if (result.kind === 'err') throw result.error;

  // Like notification — best-effort, post-commit.
  if (result.reviewData.userId && result.reviewData.userId !== callerUid) {
    try {
      const likerDoc = await db.collection('users').doc(callerUid).get();
      const likerData = likerDoc.data();
      await createLikeNotification(db, {
        reviewId,
        reviewText: result.reviewData.text || '',
        tmdbId: result.reviewData.tmdbId,
        mediaType: result.reviewData.mediaType,
        movieTitle: result.reviewData.movieTitle,
        reviewAuthorId: result.reviewData.userId,
        fromUserId: callerUid,
        fromUsername: likerData?.username || null,
        fromDisplayName: likerData?.displayName || null,
        fromPhotoUrl: likerData?.photoURL || null,
      });
    } catch (err) {
      console.error('[likeReview] notification create failed:', err);
    }
  }

  return { likes: result.newLikes };
}

// ─── unlikeReview — transactional (AUDIT 3.5) ────────────────────────────

export async function unlikeReview(
  callerUid: string,
  reviewId: string,
): Promise<{ likes: number }> {
  const db = getDb();
  const reviewRef = db.collection('reviews').doc(reviewId);

  type TxOk = { kind: 'ok'; newLikes: number };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reviewRef);
    if (!snap.exists) return { kind: 'err' as const, error: new ReviewNotFoundError() };
    const data = snap.data() || {};
    const likedBy: string[] = data.likedBy || [];
    if (!likedBy.includes(callerUid)) {
      return { kind: 'err' as const, error: new NotLikedError() };
    }
    tx.update(reviewRef, {
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(callerUid),
    });
    return { kind: 'ok' as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
  });
  if (result.kind === 'err') throw result.error;
  return { likes: result.newLikes };
}

// ─── getUserReviewForMovie ────────────────────────────────────────────────

export async function getUserReviewForMovie(
  userId: string,
  tmdbId: number,
): Promise<Review | null> {
  const db = getDb();
  const snap = await db
    .collection('reviews')
    .where('userId', '==', userId)
    .where('tmdbId', '==', tmdbId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return reviewFromDoc(snap.docs[0]);
}
