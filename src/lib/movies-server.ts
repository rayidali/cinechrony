/**
 * Movie-in-list server logic — Phase A PR #4.
 *
 * Pure server-side module (no `'use server'`). Each function takes an already-
 * verified caller uid; the route wrapper does the auth check. Errors are
 * thrown as typed classes so the route maps them to the right HTTP status.
 *
 * Closes:
 *   - AUDIT.md 1.6 — note keyed by VERIFIED uid, not client param. Collaborator
 *     can't spoof or delete another member's note.
 *   - AUDIT.md 2.2 — add + remove use db.runTransaction for the
 *     existence-check / write / movieCount-change triple. Concurrent same-key
 *     adds collapse to one increment; ghost removes never decrement count.
 *
 * Sibling routes the client used to hit directly via `updateDocumentNonBlocking`
 * (status, socialLink, delete) now go through these helpers — the route layer
 * enforces canEditList, which raw Firestore writes were bypassing. Firestore
 * rules were the only previous guard; now there's a server check.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import type { SearchResult } from '@/lib/types';
import { canEditList, invalidateListPreview } from '@/lib/lists-server';
import { emitActivity } from '@/lib/activities-server';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class MovieNotFoundError extends Error {
  constructor(message = 'Movie not found in this list.') {
    super(message);
    this.name = 'MovieNotFoundError';
  }
}

export class ListAccessDeniedError extends Error {
  constructor(action = 'modify movies in') {
    super(`You do not have permission to ${action} this list.`);
    this.name = 'ListAccessDeniedError';
  }
}

export class MovieValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MovieValidationError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_NOTE_LENGTH = 1000;
const MAX_SOCIAL_LINK_LENGTH = 500;
type MovieStatus = 'To Watch' | 'Watched';
const VALID_STATUSES: readonly MovieStatus[] = ['To Watch', 'Watched'];

// ─── addMovieToList ───────────────────────────────────────────────────────

export type AddMovieInput = {
  movieData: SearchResult;
  socialLink?: string;
  note?: string;
  status?: MovieStatus;
};

/**
 * Add a movie (or TV show) to a list. The doc ID is prefixed with the media
 * type so a movie and a TV show with the same TMDB ID don't collide.
 *
 * AUDIT.md 2.2: movie write + movieCount increment happen inside one
 * `runTransaction`. Firestore's contention retry collapses concurrent
 * same-key adds to a single increment.
 *
 * AUDIT.md 2.2.3: every raw TMDB field is coalesced to `null` — `undefined`
 * silently kills Admin SDK writes.
 *
 * Returns `{ movieId, isNew }` — `isNew` is true on first add, false on
 * idempotent re-add (no count change, merge-set keeps existing fields).
 */
export async function addMovieToList(
  callerUid: string,
  listOwnerId: string,
  listId: string,
  input: AddMovieInput,
): Promise<{ movieId: string; isNew: boolean }> {
  if (!input?.movieData) {
    throw new MovieValidationError('movieData is required.');
  }
  const status: MovieStatus = input.status ?? 'To Watch';
  if (!VALID_STATUSES.includes(status)) {
    throw new MovieValidationError('Invalid status.');
  }
  const socialLink = (input.socialLink ?? '').slice(0, MAX_SOCIAL_LINK_LENGTH);
  const note = (input.note ?? '').slice(0, MAX_NOTE_LENGTH);

  const allowed = await canEditList(callerUid, listOwnerId, listId);
  if (!allowed) throw new ListAccessDeniedError('add movies to');

  const db = getDb();
  const movieData = input.movieData;
  const mediaType = movieData.mediaType || 'movie';
  const docId = `${mediaType}_${movieData.id}`;

  const movieRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId)
    .collection('movies').doc(docId);
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);

  // Denormalize author profile onto the movie doc (avoids N+1 on render).
  const userDoc = await db.collection('users').doc(callerUid).get();
  const userData = userDoc.exists ? userDoc.data() : null;

  const movieDoc: Record<string, unknown> = {
    id: docId,
    title: movieData.title ?? null,
    year: movieData.year ?? null,
    posterUrl: movieData.posterUrl ?? null,
    posterHint: movieData.posterHint ?? null,
    mediaType,
    addedBy: callerUid,
    addedByDisplayName: userData?.displayName || null,
    addedByPhotoURL: userData?.photoURL || null,
    addedByUsername: userData?.username || null,
    socialLink,
    status,
    createdAt: FieldValue.serverTimestamp(),
    tmdbId: movieData.tmdbId || parseInt(movieData.id, 10) || null,
    overview: movieData.overview || null,
    rating: movieData.rating || null,
    backdropUrl: movieData.backdropUrl || null,
  };

  if (note) {
    movieDoc.notes = { [callerUid]: note };
    movieDoc.noteAuthors = {
      [callerUid]: {
        username: userData?.username || null,
        displayName: userData?.displayName || null,
        photoURL: userData?.photoURL || null,
      },
    };
  }

  // Atomic existence-check + write + count.
  const isNew = await db.runTransaction(async (tx) => {
    const existing = await tx.get(movieRef);
    const fresh = !existing.exists;
    tx.set(movieRef, movieDoc, { merge: true });
    tx.update(listRef, {
      updatedAt: FieldValue.serverTimestamp(),
      ...(fresh ? { movieCount: FieldValue.increment(1) } : {}),
    });
    return fresh;
  });

  // The grid-card preview (posters + count) just changed — drop its cache so
  // /lists + /profile reflect the add without waiting out the TTL.
  if (isNew) invalidateListPreview(listOwnerId, listId);

  // Best-effort activity emit on genuinely new additions. Failure here cannot
  // roll back the add (matches legacy behavior).
  if (isNew) {
    try {
      const listDoc = await listRef.get();
      const listData = listDoc.data();
      await emitActivity({
        userId: callerUid,
        type: 'added',
        tmdbId: movieData.tmdbId || parseInt(movieData.id, 10) || 0,
        movieTitle: movieData.title,
        moviePosterUrl: movieData.posterUrl || null,
        movieYear: movieData.year,
        mediaType,
        listId,
        listName: listData?.name || 'Watchlist',
      });
    } catch (err) {
      console.error('[addMovieToList] activity emit failed:', err);
    }
  }

  return { movieId: docId, isNew };
}

// ─── removeMovieFromList ──────────────────────────────────────────────────

/**
 * Delete a movie + transactionally decrement movieCount IF the movie actually
 * existed. AUDIT.md 2.2: ghost removes (double-tap, stale UI) used to drift
 * count negative; now they're a clean no-op.
 */
export async function removeMovieFromList(
  callerUid: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
): Promise<{ removed: boolean }> {
  const allowed = await canEditList(callerUid, listOwnerId, listId);
  if (!allowed) throw new ListAccessDeniedError('remove movies from');

  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);
  const movieRef = listRef.collection('movies').doc(movieId);

  const removed = await db.runTransaction(async (tx) => {
    const existing = await tx.get(movieRef);
    if (!existing.exists) return false;
    tx.delete(movieRef);
    tx.update(listRef, {
      updatedAt: FieldValue.serverTimestamp(),
      movieCount: FieldValue.increment(-1),
    });
    return true;
  });

  if (removed) invalidateListPreview(listOwnerId, listId);

  return { removed };
}

// ─── updateMovie — collapsed status / note / socialLink ───────────────────

export type UpdateMovieFields = {
  status?: MovieStatus;
  note?: string;
  socialLink?: string;
};

/**
 * Partial update of a movie doc — { status?, note?, socialLink? }. Mirrors
 * PR #2's collapsed PATCH /me pattern; the legacy actions
 * updateMovieStatus + updateMovieNote (+ direct-write socialLink edits)
 * collapse into this one route surface.
 *
 * AUDIT.md 1.6: `note` writes use `notes.${VERIFIED_UID}` — a collaborator
 * physically cannot author or clear another member's note. Empty string
 * deletes the caller's own note + noteAuthors entry.
 *
 * Returns `{ wroteWatchedActivity }` so the caller can decide whether to
 * surface the resulting activity in UI without re-fetching.
 */
export async function updateMovie(
  callerUid: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
  fields: UpdateMovieFields,
): Promise<{ wroteWatchedActivity: boolean }> {
  // Validate first (cheap), then check permission, then check existence.
  // status
  let validStatus: MovieStatus | undefined;
  if (fields.status !== undefined) {
    if (!VALID_STATUSES.includes(fields.status)) {
      throw new MovieValidationError('Invalid status.');
    }
    validStatus = fields.status;
  }
  // note — '' is valid (means "clear my note")
  let validNote: string | undefined;
  if (fields.note !== undefined) {
    if (typeof fields.note !== 'string') {
      throw new MovieValidationError('note must be a string.');
    }
    validNote = fields.note.trim().slice(0, MAX_NOTE_LENGTH);
  }
  // socialLink — '' is valid (means "clear social link")
  let validSocialLink: string | undefined;
  if (fields.socialLink !== undefined) {
    if (typeof fields.socialLink !== 'string') {
      throw new MovieValidationError('socialLink must be a string.');
    }
    validSocialLink = fields.socialLink.trim().slice(0, MAX_SOCIAL_LINK_LENGTH);
  }
  if (
    validStatus === undefined &&
    validNote === undefined &&
    validSocialLink === undefined
  ) {
    throw new MovieValidationError('No updatable fields provided.');
  }

  const allowed = await canEditList(callerUid, listOwnerId, listId);
  if (!allowed) throw new ListAccessDeniedError('modify movies in');

  const db = getDb();
  const listRef = db
    .collection('users').doc(listOwnerId)
    .collection('lists').doc(listId);
  const movieRef = listRef.collection('movies').doc(movieId);

  const movieDoc = await movieRef.get();
  if (!movieDoc.exists) throw new MovieNotFoundError();
  const movieData = movieDoc.data() || {};

  const updates: Record<string, unknown> = {};

  if (validStatus !== undefined) {
    updates.status = validStatus;
  }

  if (validSocialLink !== undefined) {
    // Match legacy behavior: empty string stored as null, not "" — keeps
    // existing `socialLink && parseVideoUrl(socialLink)` guards in the UI
    // working without changes.
    updates.socialLink = validSocialLink || null;
  }

  if (validNote !== undefined) {
    const noteKey = `notes.${callerUid}`;
    const noteAuthorKey = `noteAuthors.${callerUid}`;
    const noteTimeKey = `noteUpdatedAt.${callerUid}`;
    if (validNote === '') {
      updates[noteKey] = FieldValue.delete();
      updates[noteAuthorKey] = FieldValue.delete();
      updates[noteTimeKey] = FieldValue.delete();
    } else {
      // Denormalize the author profile alongside the note.
      const userDoc = await db.collection('users').doc(callerUid).get();
      const userData = userDoc.data();
      updates[noteKey] = validNote;
      updates[noteAuthorKey] = {
        username: userData?.username || null,
        displayName: userData?.displayName || null,
        photoURL: userData?.photoURL || null,
      };
      // Per-note timestamp powers the notes board's ordering + relative time.
      updates[noteTimeKey] = FieldValue.serverTimestamp();
    }
  }

  await movieRef.update(updates);

  await listRef.update({ updatedAt: FieldValue.serverTimestamp() });

  // Emit a 'watched' activity if the status flipped to Watched. Best-effort.
  const wroteWatchedActivity =
    validStatus === 'Watched' && movieData.status !== 'Watched';
  if (wroteWatchedActivity) {
    try {
      await emitActivity({
        userId: callerUid,
        type: 'watched',
        tmdbId: movieData.tmdbId || 0,
        movieTitle: movieData.title || 'Unknown',
        moviePosterUrl: movieData.posterUrl || null,
        movieYear: movieData.year || '',
        mediaType: movieData.mediaType || 'movie',
      });
    } catch (err) {
      console.error('[updateMovie] watched-activity emit failed:', err);
    }
  }

  return { wroteWatchedActivity };
}
