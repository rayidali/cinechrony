/**
 * Watch-log server logic — Phase 0.7 Wave 2 (slice 3).
 *
 * A "watch" is one viewing event, stored under `/users/{uid}/watches/{id}`
 * (owner-read, server-write — see `firestore.rules`). It carries a per-watch
 * rating snapshot + an optional note, and an `ordinal` so the UI can label
 * "first watch" / "rewatch no. N".
 *
 * `logWatch` is the F03 "how was it?" write. The watch doc is the source of
 * truth for history; logWatch ALSO (best-effort, never blocking the watch):
 *   - upserts the canonical rating in `/ratings` (so "your rating" tracks it);
 *   - makes the note your single public review ("becomes your review") —
 *     updates the existing one or creates it.
 * Status flips + the `watched` activity stay with the list movie PATCH
 * (`updateMovie`), so logWatch never double-emits.
 *
 * Quota: history reads use a single `where('tmdbId','==',id)` equality on the
 * per-user subcollection — Firestore's AUTOMATIC single-field index serves it,
 * so there is NO composite index to deploy. Ordinal uses a `count()` aggregate.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { createOrUpdateRating } from '@/lib/ratings-server';
import { createReview, updateReview, getUserReviewForMovie } from '@/lib/reviews-server';
import type { Watch } from '@/lib/types';

export class WatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchValidationError';
  }
}

export class WatchNotFoundError extends Error {
  constructor(message = 'Watch not found.') {
    super(message);
    this.name = 'WatchNotFoundError';
  }
}

export type LogWatchInput = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string | null;
  /** This watch's rating (1–10). Omit/null to skip rating. */
  rating?: number | null;
  /** Optional note — becomes the caller's public review for the film. */
  note?: string | null;
  /** ISO string; defaults to now. */
  watchedAt?: string;
};

const MAX_NOTE = 500;

function watchFromDoc(doc: FirebaseFirestore.DocumentSnapshot): Watch {
  const d = doc.data() || {};
  return {
    id: doc.id,
    userId: d.userId,
    tmdbId: d.tmdbId,
    mediaType: d.mediaType,
    movieTitle: d.movieTitle,
    moviePosterUrl: d.moviePosterUrl ?? null,
    watchedAt: d.watchedAt?.toDate?.() || new Date(),
    rating: typeof d.rating === 'number' ? d.rating : null,
    note: d.note ?? null,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 1,
    createdAt: d.createdAt?.toDate?.() || new Date(),
  };
}

/**
 * The LEAN core of a watch: validate, derive the ordinal, write the watch doc,
 * return it. NO rating upsert, NO review creation — callers that want those
 * side-effects (F03 `logWatch`) layer them on top; callers that don't (a post
 * recording a viewing) call this directly so the post body isn't duplicated
 * into a separate /reviews doc.
 */
export async function recordWatchEntry(
  callerUid: string,
  input: LogWatchInput,
): Promise<{ watch: Watch }> {
  if (typeof input.tmdbId !== 'number') throw new WatchValidationError('tmdbId is required.');
  if (input.mediaType !== 'movie' && input.mediaType !== 'tv') {
    throw new WatchValidationError('mediaType must be "movie" or "tv".');
  }
  if (typeof input.movieTitle !== 'string' || !input.movieTitle.trim()) {
    throw new WatchValidationError('movieTitle is required.');
  }
  if (input.rating != null && (typeof input.rating !== 'number' || input.rating < 1 || input.rating > 10)) {
    throw new WatchValidationError('rating must be between 1.0 and 10.0.');
  }

  const db = getDb();
  const col = db.collection('users').doc(callerUid).collection('watches');

  // ordinal = (existing watches for this film) + 1 — count() keeps it cheap.
  let ordinal = 1;
  try {
    const agg = await col.where('tmdbId', '==', input.tmdbId).count().get();
    ordinal = (agg.data().count ?? 0) + 1;
  } catch {
    // Fall back to a doc read if the aggregate is unavailable.
    const snap = await col.where('tmdbId', '==', input.tmdbId).get();
    ordinal = snap.size + 1;
  }

  const rating = typeof input.rating === 'number' ? Math.round(input.rating * 10) / 10 : null;
  const note = typeof input.note === 'string' && input.note.trim()
    ? input.note.trim().slice(0, MAX_NOTE)
    : null;
  const moviePosterUrl = input.moviePosterUrl ?? null;
  const watchedAtDate = input.watchedAt ? new Date(input.watchedAt) : new Date();
  const watchedAt = Number.isNaN(watchedAtDate.getTime()) ? new Date() : watchedAtDate;

  const ref = col.doc();
  await ref.set({
    id: ref.id,
    userId: callerUid,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    movieTitle: input.movieTitle.trim(),
    moviePosterUrl,
    watchedAt,
    rating,
    note,
    ordinal,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    watch: {
      id: ref.id,
      userId: callerUid,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      movieTitle: input.movieTitle.trim(),
      moviePosterUrl,
      watchedAt,
      rating,
      note,
      ordinal,
      createdAt: new Date(),
    },
  };
}

export async function logWatch(
  callerUid: string,
  input: LogWatchInput,
): Promise<{ watch: Watch }> {
  const { watch } = await recordWatchEntry(callerUid, input);
  const { rating, note } = watch;
  const moviePosterUrl = watch.moviePosterUrl;

  // Upsert the canonical rating (best-effort — the watch already landed).
  if (rating != null) {
    try {
      await createOrUpdateRating(callerUid, {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        movieTitle: input.movieTitle,
        moviePosterUrl: moviePosterUrl ?? undefined,
        rating,
      });
    } catch (err) {
      console.error('[logWatch] rating upsert failed:', err);
    }
  }

  // The note becomes your single public review (update or create).
  if (note) {
    try {
      const existing = await getUserReviewForMovie(callerUid, input.tmdbId);
      if (existing) {
        await updateReview(callerUid, existing.id, { text: note });
      } else {
        await createReview(callerUid, {
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          movieTitle: input.movieTitle,
          moviePosterUrl: moviePosterUrl ?? undefined,
          text: note,
          ratingAtTime: rating,
        });
      }
    } catch (err) {
      console.error('[logWatch] review upsert failed:', err);
    }
  }

  return { watch };
}

/**
 * The caller's watches for a film, newest first. Index-free (tmdbId equality).
 * Ordinal is DERIVED from chronological order at read time (oldest = "first
 * watch" = 1), NOT the stored field — so deleting a watch correctly re-labels
 * the rest ("rewatch no. 2" becomes the first watch) with no recompute-on-write.
 */
export async function getWatchesForMovie(
  callerUid: string,
  tmdbId: number,
): Promise<{ watches: Watch[] }> {
  if (typeof tmdbId !== 'number' || Number.isNaN(tmdbId)) {
    throw new WatchValidationError('tmdbId is required.');
  }
  const db = getDb();
  const snap = await db
    .collection('users').doc(callerUid)
    .collection('watches')
    .where('tmdbId', '==', tmdbId)
    .get();
  const asc = snap.docs
    .map(watchFromDoc)
    .sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime());
  asc.forEach((w, i) => { w.ordinal = i + 1; }); // derive ordinal chronologically
  const watches = asc.slice().reverse(); // newest first for display
  return { watches };
}

/** The caller's recently-watched DISTINCT films, newest first — backs the
 *  "recently watched" rail in the film picker. Scans the most recent watches
 *  (single-field `watchedAt` index, no composite) and dedupes by tmdbId. */
export async function getRecentWatches(
  callerUid: string,
  limit = 12,
): Promise<{ films: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null }[] }> {
  const db = getDb();
  const snap = await db
    .collection('users').doc(callerUid)
    .collection('watches')
    .orderBy('watchedAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 24) * 3) // over-scan to allow dedupe
    .get();
  const seen = new Set<number>();
  const films: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null }[] = [];
  for (const d of snap.docs) {
    const w = watchFromDoc(d);
    if (seen.has(w.tmdbId)) continue;
    seen.add(w.tmdbId);
    films.push({ tmdbId: w.tmdbId, mediaType: w.mediaType, title: w.movieTitle, posterUrl: w.moviePosterUrl ?? null });
    if (films.length >= limit) break;
  }
  return { films };
}

/** Owner-only edit of a single watch's rating + note (the per-watch log entry
 *  shown in "your history"). Does NOT touch the canonical /ratings or /reviews —
 *  those are edited via the drag-to-rate / comments. */
export async function updateWatch(
  callerUid: string,
  watchId: string,
  fields: { rating?: number | null; note?: string | null },
): Promise<{ watch: Watch }> {
  if (!watchId) throw new WatchValidationError('watchId is required.');
  const db = getDb();
  const ref = db.collection('users').doc(callerUid).collection('watches').doc(watchId);
  const snap = await ref.get();
  if (!snap.exists) throw new WatchNotFoundError();

  const updates: Record<string, unknown> = {};
  if (fields.rating !== undefined) {
    if (fields.rating !== null && (typeof fields.rating !== 'number' || fields.rating < 1 || fields.rating > 10)) {
      throw new WatchValidationError('rating must be between 1.0 and 10.0.');
    }
    updates.rating = fields.rating === null ? null : Math.round(fields.rating * 10) / 10;
  }
  if (fields.note !== undefined) {
    updates.note = typeof fields.note === 'string' && fields.note.trim()
      ? fields.note.trim().slice(0, MAX_NOTE)
      : null;
  }
  if (Object.keys(updates).length > 0) await ref.update(updates);
  const fresh = await ref.get();
  return { watch: watchFromDoc(fresh) };
}

/** Owner-only delete of a single watch (undo an accidental log). Remaining
 *  watches re-derive their ordinals on the next read. When the LAST watch for a
 *  film is removed, the film is no longer "watched" — so the matching 'watched'
 *  activity is cleaned up too (best-effort), mirroring deleteRating, so it
 *  leaves the profile's "recent" feed instead of lingering. */
export async function deleteWatch(callerUid: string, watchId: string): Promise<void> {
  if (!watchId) throw new WatchValidationError('watchId is required.');
  const db = getDb();
  const col = db.collection('users').doc(callerUid).collection('watches');
  const ref = col.doc(watchId);
  const snap = await ref.get();
  if (!snap.exists) throw new WatchNotFoundError();
  const tmdbId = snap.data()?.tmdbId as number | undefined;
  await ref.delete();

  // If that was the last viewing of this film, drop the 'watched' activity.
  if (typeof tmdbId === 'number') {
    try {
      let remaining = 0;
      try {
        const agg = await col.where('tmdbId', '==', tmdbId).count().get();
        remaining = agg.data().count ?? 0;
      } catch {
        const rest = await col.where('tmdbId', '==', tmdbId).get();
        remaining = rest.size;
      }
      if (remaining === 0) {
        const recent = await db
          .collection('activities')
          .where('userId', '==', callerUid)
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get();
        const batch = db.batch();
        let n = 0;
        recent.docs.forEach((d) => {
          const a = d.data();
          if (a.type === 'watched' && a.tmdbId === tmdbId) { batch.delete(d.ref); n++; }
        });
        if (n > 0) await batch.commit();
      }
    } catch (err) {
      console.error('[deleteWatch] watched-activity cleanup failed:', err);
    }
  }
}
