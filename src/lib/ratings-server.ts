/**
 * User-rating server logic — Phase A PR #9.
 *
 * Ratings are 1.0–10.0 with one decimal place, indexed by composite key
 * `{userId}_{tmdbId}`. One rating per user per movie/TV show — re-rating
 * mutates the same doc.
 *
 * Closes / preserves:
 *   - AUDIT.md 2.5 — `getUserRatings` supports cursor pagination
 *     (`updatedAt` ISO timestamp). The Letterboxd-importer regression
 *     where the ratings cache silently capped at 500 → 1000+ ratings
 *     lost is fixed by callers paginating; the endpoint exposes that.
 *
 * Side effects: `createOrUpdateRating` emits a `rated` activity on the
 * FIRST rating (re-rates don't re-emit). Best-effort.
 */

import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { emitActivity } from '@/lib/activities-server';
import type { UserRating } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class RatingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatingValidationError';
  }
}

export class RatingNotFoundError extends Error {
  constructor(message = 'Rating not found.') {
    super(message);
    this.name = 'RatingNotFoundError';
  }
}

export class RatingOwnerMismatchError extends Error {
  constructor(message = 'You can only delete your own ratings.') {
    super(message);
    this.name = 'RatingOwnerMismatchError';
  }
}

// ─── Constants + helpers ──────────────────────────────────────────────────

const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

function ratingId(userUid: string, tmdbId: number): string {
  return `${userUid}_${tmdbId}`;
}

function ratingFromDoc(doc: FirebaseFirestore.DocumentSnapshot): UserRating {
  const data = doc.data() || {};
  return {
    id: doc.id,
    userId: data.userId,
    tmdbId: data.tmdbId,
    mediaType: data.mediaType,
    movieTitle: data.movieTitle,
    moviePosterUrl: data.moviePosterUrl,
    rating: data.rating,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  } as UserRating;
}

// ─── createOrUpdateRating ─────────────────────────────────────────────────

export type CreateRatingInput = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  rating: number;
};

export async function createOrUpdateRating(
  callerUid: string,
  input: CreateRatingInput,
): Promise<{ rating: UserRating; isNew: boolean }> {
  if (typeof input.rating !== 'number' || Number.isNaN(input.rating)) {
    throw new RatingValidationError('rating must be a number.');
  }
  if (input.rating < 1 || input.rating > 10) {
    throw new RatingValidationError('Rating must be between 1.0 and 10.0.');
  }
  if (typeof input.tmdbId !== 'number') {
    throw new RatingValidationError('tmdbId is required.');
  }
  if (input.mediaType !== 'movie' && input.mediaType !== 'tv') {
    throw new RatingValidationError('mediaType must be "movie" or "tv".');
  }
  if (typeof input.movieTitle !== 'string') {
    throw new RatingValidationError('movieTitle is required.');
  }

  const roundedRating = Math.round(input.rating * 10) / 10;

  const db = getDb();
  const ratingRef = db.collection('ratings').doc(ratingId(callerUid, input.tmdbId));
  const existing = await ratingRef.get();
  const isNew = !existing.exists;

  const ratingData = {
    id: ratingRef.id,
    userId: callerUid,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    movieTitle: input.movieTitle,
    moviePosterUrl: input.moviePosterUrl || null,
    rating: roundedRating,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (isNew) {
    await ratingRef.set({
      ...ratingData,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ratingRef.update(ratingData);
  }

  // 'rated' activity emit only on the FIRST rating. Re-rates DO change the
  // value but don't fan out new activity (avoids notification spam — they
  // can re-watch and re-review a year later instead).
  if (isNew) {
    try {
      await emitActivity({
        userId: callerUid,
        type: 'rated',
        tmdbId: input.tmdbId,
        movieTitle: input.movieTitle,
        moviePosterUrl: input.moviePosterUrl || null,
        movieYear: '',
        mediaType: input.mediaType,
        rating: roundedRating,
      });
    } catch (err) {
      console.error('[createOrUpdateRating] activity emit failed:', err);
    }
  }

  // Return the rating with concrete Date objects.
  return {
    rating: {
      ...ratingData,
      createdAt: isNew ? new Date() : existing.data()?.createdAt?.toDate?.() || new Date(),
      updatedAt: new Date(),
    } as unknown as UserRating,
    isNew,
  };
}

// ─── getUserRating ────────────────────────────────────────────────────────

export async function getUserRating(
  userId: string,
  tmdbId: number,
): Promise<UserRating | null> {
  const db = getDb();
  const ratingDoc = await db.collection('ratings').doc(ratingId(userId, tmdbId)).get();
  if (!ratingDoc.exists) return null;
  return ratingFromDoc(ratingDoc);
}

// ─── deleteRating — owner-only ────────────────────────────────────────────

export async function deleteRating(
  callerUid: string,
  tmdbId: number,
): Promise<void> {
  const db = getDb();
  const ratingRef = db.collection('ratings').doc(ratingId(callerUid, tmdbId));
  const ratingDoc = await ratingRef.get();
  if (!ratingDoc.exists) throw new RatingNotFoundError();
  // Doc ID encodes ownership (`${callerUid}_${tmdbId}`), so the lookup
  // itself enforces caller-owns-it. The explicit field check is a
  // belt-and-suspenders against any legacy doc that drifted from the
  // naming convention.
  if (ratingDoc.data()?.userId !== callerUid) {
    throw new RatingOwnerMismatchError();
  }
  await ratingRef.delete();

  // Clearing a rating undoes the 'rated' event — remove the matching activity so
  // it leaves the profile's "recent" feed (and the leaderboard tally). Best-
  // effort; uses the existing (userId, createdAt) index, scans the caller's
  // recent activity (a just-rated film's activity is recent → covered).
  try {
    const db2 = getDb();
    const recent = await db2
      .collection('activities')
      .where('userId', '==', callerUid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const batch = db2.batch();
    let n = 0;
    recent.docs.forEach((d) => {
      const a = d.data();
      if (a.type === 'rated' && a.tmdbId === tmdbId) { batch.delete(d.ref); n++; }
    });
    if (n > 0) await batch.commit();
  } catch (err) {
    console.error('[deleteRating] rated-activity cleanup failed:', err);
  }
}

// ─── getUserRatings — cursor pagination (AUDIT 2.5) ──────────────────────

export async function getUserRatings(
  userId: string,
  opts: { limit?: number; cursor?: string; since?: string } = {},
): Promise<{ ratings: UserRating[]; hasMore: boolean; nextCursor?: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE), MAX_PAGE);
  const db = getDb();

  // KEYSET cursor on (updatedAt DESC, __name__ ASC). The explicit documentId()
  // tiebreak matches Firestore's IMPLICIT `__name__ ASC` ordering, so it uses
  // the SAME index (no new composite index). This is what makes pagination
  // correct under ties: a Letterboxd import commits ~225 ratings per batch that
  // all share one serverTimestamp, so a same-timestamp group routinely straddles
  // a 500-row page boundary. A bare-timestamp `startAfter(date)` skipped the
  // WHOLE tie group's tail (those films then rendered as unrated forever); the
  // (updatedAt, docId) cursor resumes correctly within the group.
  let q: FirebaseFirestore.Query = db
    .collection('ratings')
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'asc');

  // Delta sync: only ratings changed at/after `since`. `>=` (not `>`) tolerates
  // ties — the client de-dupes by tmdbId so re-including the boundary is
  // harmless. Same (userId ==, updatedAt) index.
  if (opts.since) {
    const sinceDate = new Date(opts.since);
    if (!Number.isNaN(sinceDate.getTime())) {
      q = q.where('updatedAt', '>=', sinceDate);
    }
  }

  if (opts.cursor) {
    // Cursor format: `<updatedAt ISO>|<docId>` (keyset). A legacy bare-timestamp
    // cursor (from a client cached before this change) still works — it just
    // resumes at the timestamp boundary as before until the next page rolls over.
    const sep = opts.cursor.lastIndexOf('|');
    const iso = sep > 0 ? opts.cursor.slice(0, sep) : opts.cursor;
    const docId = sep > 0 ? opts.cursor.slice(sep + 1) : '';
    const cursorDate = new Date(iso);
    if (!Number.isNaN(cursorDate.getTime())) {
      q = docId ? q.startAfter(cursorDate, docId) : q.startAfter(cursorDate);
    }
  }

  // Fetch limit+1 to compute hasMore.
  const snap = await q.limit(limit + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;
  const ratings = pageDocs.map(ratingFromDoc);

  const nextCursor =
    hasMore && pageDocs.length > 0
      ? (() => {
          const last = pageDocs[pageDocs.length - 1];
          const iso = (last.data()?.updatedAt?.toDate?.() as Date | undefined)?.toISOString();
          return iso ? `${iso}|${last.id}` : undefined;
        })()
      : undefined;

  return { ratings, hasMore, nextCursor };
}
