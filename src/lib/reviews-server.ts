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
import { createTtlCache, cached } from '@/lib/server-cache';
import { getMyBlockSet } from '@/lib/blocks-server';
import { getFollowingIds } from '@/lib/follows-server';
import { isReactionType, type ReactionType, type ReactionCounts } from '@/lib/review-reactions';
import { verdictForRating, type Verdict } from '@/lib/review-verdict';
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
    reactions: {},
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

// ─── Hot-takes (home "green quote card", 0.7.5.4) ──────────────────────────
//
// A "hot take" = a short, glowing, top-level review — surfaced as the green
// quote card interleaved into the home reel. Real data only: an empty pool
// hides the card (no fabrication), same contract as the discovery rails.
//
// Quota-first (free-tier Firestore is the binding constraint):
//   - ONE GLOBAL pool, shared across all viewers, built from a single
//     index-free `createdAt desc` scan (the automatic single-field index — no
//     composite index to deploy) and held in a module TTL cache. On a warm
//     Vercel (Fluid Compute) instance the scan runs at most once per TTL, so
//     N home loads cost ~0 reads instead of N×scan.
//   - Per-caller work is in-memory only: drop the caller's own takes + anyone
//     in their block invisibility set (cached). The client additionally filters
//     mutes/blocks, mirroring the main feed.
//   - The long TTL is deliberate — great reviews are evergreen, and on the
//     Spark plan a fresh-to-the-minute decorative card isn't worth the reads.
//     If reviews ever grow huge, move the pool to the `/snapshots/home` doc
//     (see `home-snapshot-server.ts`) like the leaderboard.

export type HotTake = {
  reviewId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl: string | null;
  text: string;
  rating: number | null;
  author: {
    uid: string;
    username: string | null;
    displayName: string | null;
    photoURL: string | null;
  };
};

const HOT_TAKE_MIN_TEXT = 12;   // longer than a one-word "great"
const HOT_TAKE_MAX_TEXT = 240;  // a punchy take, not an essay
const HOT_TAKE_MIN_RATING = 8;  // a genuine rave
const HOT_TAKE_SCAN = 200;      // recent reviews to consider per rebuild (wide
                                // enough that replies/low-rated don't starve the
                                // pool as the app grows; still one cheap read)
const HOT_TAKE_POOL = 24;       // candidates kept (one per film, varied)

// 30-min TTL — caps rebuilds at ~48/day per warm instance × HOT_TAKE_SCAN reads.
const hotTakeCache = createTtlCache<HotTake[]>({ ttlMs: 1_800_000, maxEntries: 2 });

async function buildHotTakePool(): Promise<HotTake[]> {
  const db = getDb();
  // Index-free: single-field `createdAt desc` only (no composite index needed).
  const snap = await db
    .collection('reviews')
    .orderBy('createdAt', 'desc')
    .limit(HOT_TAKE_SCAN)
    .get();

  const seenMovies = new Set<number>();
  const pool: HotTake[] = [];
  for (const doc of snap.docs) {
    const r = doc.data() as {
      parentId?: string | null;
      text?: unknown;
      ratingAtTime?: unknown;
      tmdbId?: unknown;
      mediaType?: unknown;
      movieTitle?: unknown;
      moviePosterUrl?: unknown;
      userId?: unknown;
      username?: unknown;
      userDisplayName?: unknown;
      userPhotoUrl?: unknown;
    };
    if (r.parentId) continue; // top-level reviews only (skip replies)
    if (typeof r.tmdbId !== 'number') continue;
    if (typeof r.userId !== 'string' || !r.userId) continue;
    const rating = typeof r.ratingAtTime === 'number' ? r.ratingAtTime : null;
    if (rating == null || rating < HOT_TAKE_MIN_RATING) continue;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (text.length < HOT_TAKE_MIN_TEXT || text.length > HOT_TAKE_MAX_TEXT) continue;
    if (seenMovies.has(r.tmdbId)) continue; // one take per film keeps it varied
    seenMovies.add(r.tmdbId);
    pool.push({
      reviewId: doc.id,
      tmdbId: r.tmdbId,
      mediaType: r.mediaType === 'tv' ? 'tv' : 'movie',
      movieTitle: typeof r.movieTitle === 'string' ? r.movieTitle : '',
      moviePosterUrl: typeof r.moviePosterUrl === 'string' ? r.moviePosterUrl : null,
      text,
      rating,
      author: {
        uid: r.userId,
        username: typeof r.username === 'string' ? r.username : null,
        displayName: typeof r.userDisplayName === 'string' ? r.userDisplayName : null,
        photoURL: typeof r.userPhotoUrl === 'string' ? r.userPhotoUrl : null,
      },
    });
    if (pool.length >= HOT_TAKE_POOL) break;
  }
  return pool;
}

/**
 * Recent hot-takes for the home reel, filtered for one caller. Returns up to
 * `limit`, excluding the caller's own takes and anyone in their block set.
 * The shared pool is cached; per-caller filtering is in-memory.
 */
export async function getReviewHighlights(callerUid: string, limit = 8): Promise<HotTake[]> {
  const [pool, blocked] = await Promise.all([
    cached(hotTakeCache, 'pool', buildHotTakePool),
    getMyBlockSet(callerUid).catch(() => new Set<string>()),
  ]);
  return pool
    .filter((t) => t.author.uid !== callerUid && !blocked.has(t.author.uid))
    .slice(0, limit);
}

// ─── Reactions (F14) ───────────────────────────────────────────────────────
//
// One reaction per user per review, stored as a `reactions: { [uid]: type }`
// map on the review doc. Writes touch only the caller's key (dot-path), so two
// users reacting concurrently never clobber each other.

function countReactions(reactions: Record<string, unknown> | undefined): ReactionCounts {
  const counts: ReactionCounts = {};
  if (!reactions) return counts;
  for (const t of Object.values(reactions)) {
    if (isReactionType(t)) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

/** Set (or replace) the caller's reaction. Transactional so the count derived
 *  for the response reflects the post-write map. */
export async function reactReview(
  callerUid: string,
  reviewId: string,
  type: ReactionType,
): Promise<{ counts: ReactionCounts; myReaction: ReactionType }> {
  if (!isReactionType(type)) throw new ReviewValidationError('Invalid reaction type.');
  const db = getDb();
  const ref = db.collection('reviews').doc(reviewId);

  type TxOk = { kind: 'ok'; reactions: Record<string, unknown> };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new ReviewNotFoundError() };
    const data = snap.data() || {};
    const reactions: Record<string, unknown> = { ...(data.reactions || {}) };
    reactions[callerUid] = type;
    tx.update(ref, { [`reactions.${callerUid}`]: type });
    return { kind: 'ok' as const, reactions };
  });
  if (result.kind === 'err') throw result.error;
  return { counts: countReactions(result.reactions), myReaction: type };
}

/** Remove the caller's reaction (idempotent — removing a non-existent reaction
 *  is a no-op, returns the current counts). */
export async function unreactReview(
  callerUid: string,
  reviewId: string,
): Promise<{ counts: ReactionCounts; myReaction: null }> {
  const db = getDb();
  const ref = db.collection('reviews').doc(reviewId);

  type TxOk = { kind: 'ok'; reactions: Record<string, unknown> };
  type TxErr = { kind: 'err'; error: Error };
  const result: TxOk | TxErr = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: 'err' as const, error: new ReviewNotFoundError() };
    const data = snap.data() || {};
    const reactions: Record<string, unknown> = { ...(data.reactions || {}) };
    delete reactions[callerUid];
    tx.update(ref, { [`reactions.${callerUid}`]: FieldValue.delete() });
    return { kind: 'ok' as const, reactions };
  });
  if (result.kind === 'err') throw result.error;
  return { counts: countReactions(result.reactions), myReaction: null };
}

// ─── Reviews wall (F12) ──────────────────────────────────────────────────────
//
// The whole reviews surface for one film in ONE read: a capped, index-free
// single-field scan (`tmdbId ==`) of every review + reply, grouped in memory
// into top-level cards with their reply bubbles, plus the aggregate summary
// (friends'-framed score + loved/liked/fine/nope distribution + friends-seen).
//
// Deliberately NOT cached: a film's reviews wall is opened interactively and the
// author must see their own just-posted review immediately (the cardinal
// no-stale-after-own-action rule). The sort tabs (helpful/recent/highest) sort
// CLIENT-side off this single payload, so changing sort costs zero reads. The
// per-caller reaction/helpful state is derived here; the raw reactions/likedBy
// maps are never shipped.

const WALL_SCAN = 250; // reviews+replies considered per film (plenty pre-scale)
const WALL_REPLY_CAP = 40; // embedded reply bubbles per top-level review

export type WallReview = {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl: string | null;
  userId: string;
  username: string | null;
  userDisplayName: string | null;
  userPhotoUrl: string | null;
  text: string;
  ratingAtTime: number | null;
  verdict: Verdict | null;
  hasSpoiler: boolean;
  parentId: string | null;
  replyCount: number;
  helpful: number; // = the existing "likes" count, surfaced as "helpful"
  myHelpful: boolean;
  reactionCounts: ReactionCounts;
  myReaction: ReactionType | null;
  createdAt: string; // ISO
  replies?: WallReview[];
};

export type ReviewSeen = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export type ReviewsSummary = {
  score: number | null; // avg rating across rated top-level reviews
  count: number; // top-level reviews (incl. ratingless notes)
  ratedCount: number;
  distribution: Record<Verdict, number>;
  friendsSeen: ReviewSeen[]; // up to 5 avatars of reviewers you follow
  friendsSeenCount: number;
};

export type ReviewsWall = {
  summary: ReviewsSummary;
  reviews: WallReview[]; // top-level, recent-first (client re-sorts)
  truncated: boolean;
};

function isoOf(value: unknown): string {
  const v = value as { toDate?: () => Date } | Date | undefined;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  return new Date(0).toISOString();
}

function toWallReview(
  id: string,
  data: FirebaseFirestore.DocumentData,
  callerUid: string | null,
): WallReview {
  const rating = typeof data.ratingAtTime === 'number' ? data.ratingAtTime : null;
  const likedBy: string[] = Array.isArray(data.likedBy) ? data.likedBy : [];
  const reactions = (data.reactions || {}) as Record<string, unknown>;
  const myRaw = callerUid ? reactions[callerUid] : undefined;
  return {
    id,
    tmdbId: data.tmdbId,
    mediaType: data.mediaType === 'tv' ? 'tv' : 'movie',
    movieTitle: typeof data.movieTitle === 'string' ? data.movieTitle : '',
    moviePosterUrl: typeof data.moviePosterUrl === 'string' ? data.moviePosterUrl : null,
    userId: typeof data.userId === 'string' ? data.userId : '',
    username: data.username ?? null,
    userDisplayName: data.userDisplayName ?? null,
    userPhotoUrl: data.userPhotoUrl ?? null,
    text: typeof data.text === 'string' ? data.text : '',
    ratingAtTime: rating,
    verdict: verdictForRating(rating),
    hasSpoiler: !!data.hasSpoiler,
    parentId: data.parentId ?? null,
    replyCount: data.replyCount || 0,
    helpful: data.likes || 0,
    myHelpful: !!callerUid && likedBy.includes(callerUid),
    reactionCounts: countReactions(reactions),
    myReaction: isReactionType(myRaw) ? myRaw : null,
    createdAt: isoOf(data.createdAt),
  };
}

const wallTime = (r: WallReview) => Date.parse(r.createdAt) || 0;

export async function getReviewsWall(
  tmdbId: number,
  callerUid: string | null,
): Promise<ReviewsWall> {
  const db = getDb();
  // ONE index-free scan (single-field equality on tmdbId — no composite index to
  // deploy, works on the free tier with zero owner action). NO orderBy on
  // purpose: `tmdbId ==` + `orderBy createdAt` would need a (tmdbId, createdAt)
  // composite the owner would have to deploy (and the wall would 500→empty until
  // they did). Consequence: a film with MORE than WALL_SCAN reviews+replies
  // returns an arbitrary (doc-id-ordered) subset, so the summary is only EXACT
  // below the cap — `truncated` flags the overflow. Pre-scale that's every film;
  // the scale-fix is a precomputed snapshot (like home-snapshot-server), tracked
  // for later. Replies whose parent fell outside the window are harmlessly
  // ignored (repliesByParent is consumed per present top-level review only).
  const snap = await db.collection('reviews').where('tmdbId', '==', tmdbId).limit(WALL_SCAN).get();
  const truncated = snap.size >= WALL_SCAN;

  const [following, blocked] = await Promise.all([
    callerUid ? getFollowingIds(callerUid, 2000).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    callerUid ? getMyBlockSet(callerUid).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  const followSet = new Set(following);

  const topLevel: WallReview[] = [];
  const repliesByParent = new Map<string, WallReview[]>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.userId === 'string' && blocked.has(data.userId)) continue; // block invisibility
    const wr = toWallReview(doc.id, data, callerUid);
    if (wr.parentId) {
      const arr = repliesByParent.get(wr.parentId) ?? [];
      arr.push(wr);
      repliesByParent.set(wr.parentId, arr);
    } else {
      topLevel.push(wr);
    }
  }

  // Attach reply bubbles (oldest-first, capped).
  for (const r of topLevel) {
    const reps = repliesByParent.get(r.id);
    if (reps && reps.length) {
      reps.sort((a, b) => wallTime(a) - wallTime(b));
      r.replies = reps.slice(0, WALL_REPLY_CAP);
    }
  }
  topLevel.sort((a, b) => wallTime(b) - wallTime(a)); // recent-first default

  // Aggregate summary over top-level reviews.
  const distribution: Record<Verdict, number> = { loved: 0, liked: 0, fine: 0, nope: 0 };
  let sum = 0;
  let ratedCount = 0;
  const seen = new Map<string, ReviewSeen>();
  for (const r of topLevel) {
    if (r.ratingAtTime != null) {
      sum += r.ratingAtTime;
      ratedCount += 1;
      if (r.verdict) distribution[r.verdict] += 1;
    }
    if (followSet.has(r.userId) && !seen.has(r.userId)) {
      seen.set(r.userId, {
        uid: r.userId,
        username: r.username,
        displayName: r.userDisplayName,
        photoURL: r.userPhotoUrl,
      });
    }
  }
  const friendsSeenAll = [...seen.values()];

  const summary: ReviewsSummary = {
    score: ratedCount > 0 ? Math.round((sum / ratedCount) * 10) / 10 : null,
    count: topLevel.length,
    ratedCount,
    distribution,
    friendsSeen: friendsSeenAll.slice(0, 5),
    friendsSeenCount: friendsSeenAll.length,
  };

  return { summary, reviews: topLevel, truncated };
}
