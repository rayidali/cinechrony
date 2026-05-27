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
import type { ActivityType } from '@/lib/types';

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
