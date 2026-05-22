'use server';

import { revalidatePath } from 'next/cache';
import type {
  SearchResult, UserProfile, ListInvite, ListMember, Activity, ActivityType,
  Post, PostMedia, TaggedUser, PostComment,
} from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp, getDb } from '@/firebase/admin';
import { verifyCaller, isAuthError } from '@/lib/auth-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { randomInt, randomUUID } from 'node:crypto';

// AUDIT.md 5.11: getDb is now the single source of truth in @/firebase/admin
// (applies ignoreUndefinedProperties once). The previous local copy here
// returned the Firestore singleton WITHOUT those settings.

// --- USER PROFILE ---

/**
 * Generates a unique username from email or display name.
 */
async function generateUniqueUsername(db: FirebaseFirestore.Firestore, email: string, displayName: string | null): Promise<string> {
  // Start with the part before @ in email, or displayName
  let baseUsername = displayName?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
                     email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

  // Ensure minimum length
  if (baseUsername.length < 3) {
    baseUsername = baseUsername + 'user';
  }

  // Check if username exists and add numbers if needed
  let username = baseUsername;
  let counter = 1;

  while (true) {
    const existing = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (existing.empty) {
      return username;
    }

    username = `${baseUsername}${counter}`;
    counter++;

    // Safety limit
    if (counter > 1000) {
      return `${baseUsername}${Date.now()}`;
    }
  }
}

/**
 * Creates a user profile and default list when a user signs up.
 */
// Private: actual profile + default-list creation, keyed by an ALREADY-TRUSTED
// uid. Reached only via the token-gated createUserProfile() wrapper below, or
// server-to-server from ensureUserProfile() (which has already verified the
// caller). Never export this — it does no auth of its own.
async function createProfileAndDefaultList(userId: string, email: string, displayName: string | null) {
  const db = getDb();

  try {
    // Generate unique username
    const username = await generateUniqueUsername(db, email, displayName);

    // Create user profile document.
    // AUDIT.md 1.9: /users/{uid} is PUBLICLY readable (firestore.rules) and
    // Firestore can't field-mask, so email must NOT live here. Private fields
    // go to /users_private/{uid} (server-only; client read denied in rules).
    const userRef = db.collection('users').doc(userId);
    await userRef.set({
      uid: userId,
      displayName: displayName,
      displayNameLower: displayName?.toLowerCase() || null,
      photoURL: null,
      username: username,
      usernameLower: username.toLowerCase(),
      followersCount: 0,
      followingCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('users_private').doc(userId).set({
      uid: userId,
      email: email,
      emailLower: email.toLowerCase(),
    });

    // Create default list
    const listRef = userRef.collection('lists').doc();
    await listRef.set({
      id: listRef.id,
      name: 'My Watchlist',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      isDefault: true,
      isPublic: true, // Default list is public by default
      ownerId: userId,
    });

    return { success: true, defaultListId: listRef.id, username };
  } catch (error) {
    console.error('Failed to create user profile:', error);
    return { error: 'Failed to create user profile.' };
  }
}

/**
 * Public, token-gated entry point. Called right after Firebase signup — the
 * client is authenticated by then, so getIdToken() yields a valid token whose
 * uid is the new user. We create the profile for THAT uid, never a client param.
 */
export async function createUserProfile(idToken: string, email: string, displayName: string | null) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  return createProfileAndDefaultList(auth.uid, email, displayName);
}

/**
 * Ensures a user has a profile and default list (for existing users).
 * Also migrates existing users to have social fields.
 */
export async function ensureUserProfile(idToken: string, email: string, displayName: string | null) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // Create profile if it doesn't exist. ensureUserProfile already verified
      // the caller, so call the private uid-keyed helper (not the token wrapper).
      return await createProfileAndDefaultList(userId, email, displayName);
    }

    // Check if user needs social fields migration
    const userData = userDoc.data();
    const needsMigration = userData && (
      userData.username === undefined ||
      userData.usernameLower === undefined ||
      userData.followersCount === undefined
    );

    if (needsMigration) {
      const username = userData?.username || await generateUniqueUsername(db, email, displayName);
      // AUDIT.md 1.9: emailLower no longer written to the public doc.
      await userRef.update({
        username: username,
        usernameLower: username.toLowerCase(),
        displayNameLower: (userData?.displayName || displayName)?.toLowerCase() || null,
        followersCount: userData?.followersCount ?? 0,
        followingCount: userData?.followingCount ?? 0,
      });
      await db.collection('users_private').doc(userId).set({
        uid: userId,
        email: userData?.email || email,
        emailLower: (userData?.email || email).toLowerCase(),
      }, { merge: true });
      console.log(`[ensureUserProfile] Migrated user ${userId} with username: ${username}`);
    }

    // Check if user has any lists
    const listsSnapshot = await userRef.collection('lists').limit(1).get();

    if (listsSnapshot.empty) {
      // Create default list if none exist
      const listRef = userRef.collection('lists').doc();
      await listRef.set({
        id: listRef.id,
        name: 'My Watchlist',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        isDefault: true,
        isPublic: true,
        ownerId: userId,
      });
      return { success: true, defaultListId: listRef.id };
    }

    // Find default list
    const defaultListQuery = await userRef
      .collection('lists')
      .where('isDefault', '==', true)
      .limit(1)
      .get();

    if (!defaultListQuery.empty) {
      return { success: true, defaultListId: defaultListQuery.docs[0].id };
    }

    // If no default list, use the first one
    return { success: true, defaultListId: listsSnapshot.docs[0].id };
  } catch (error) {
    console.error('Failed to ensure user profile:', error);
    return { error: 'Failed to ensure user profile.' };
  }
}

// --- LIST OPERATIONS ---

/**
 * Creates a new list for a user.
 */
export async function createList(idToken: string, name: string, isPublic: boolean = true) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const listRef = db.collection('users').doc(userId).collection('lists').doc();
    await listRef.set({
      id: listRef.id,
      name: name.trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      isDefault: false,
      isPublic: isPublic,
      ownerId: userId,
      likes: 0,
      likedBy: [],
    });

    revalidatePath('/lists');
    return { success: true, listId: listRef.id };
  } catch (error) {
    console.error('Failed to create list:', error);
    return { error: 'Failed to create list.' };
  }
}

/**
 * Renames a list.
 * Only the list owner can rename.
 */
export async function renameList(idToken: string, listOwnerId: string, listId: string, newName: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Only owner can rename
    if (userId !== listOwnerId) {
      return { error: 'Only the list owner can rename the list.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    await listRef.update({
      name: newName.trim(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to rename list:', error);
    return { error: 'Failed to rename list.' };
  }
}

/**
 * Update list description.
 * Only the list owner can update the description.
 */
export async function updateListDescription(idToken: string, listOwnerId: string, listId: string, description: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Only owner can update description
    if (userId !== listOwnerId) {
      return { error: 'Only the list owner can update the description.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    await listRef.update({
      description: description.trim(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to update list description:', error);
    return { error: 'Failed to update description.' };
  }
}

/**
 * Update list visibility (public/private).
 * Only the list owner can update visibility.
 */
export async function updateListVisibility(idToken: string, listOwnerId: string, listId: string, isPublic: boolean) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Only owner can update visibility
    if (userId !== listOwnerId) {
      return { error: 'Only the list owner can update visibility.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    await listRef.update({
      isPublic,
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to update list visibility:', error);
    return { error: 'Failed to update visibility.' };
  }
}

/**
 * Deletes a list and all its movies.
 * Cannot delete the default list.
 * Only the list owner can delete.
 */
export async function deleteList(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Only owner can delete
    if (userId !== listOwnerId) {
      return { error: 'Only the list owner can delete the list.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    if (listDoc.data()?.isDefault) {
      return { error: 'Cannot delete your default list.' };
    }

    // Delete all movies in the list first
    const moviesSnapshot = await listRef.collection('movies').get();
    const batch = db.batch();
    moviesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Delete the list itself
    batch.delete(listRef);
    await batch.commit();

    // Also mark any pending invites as revoked
    const pendingInvites = await db.collection('invites')
      .where('listId', '==', listId)
      .where('listOwnerId', '==', listOwnerId)
      .where('status', '==', 'pending')
      .get();

    if (!pendingInvites.empty) {
      const inviteBatch = db.batch();
      pendingInvites.docs.forEach((doc) => {
        inviteBatch.update(doc.ref, { status: 'revoked' });
      });
      await inviteBatch.commit();
    }

    revalidatePath('/lists');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete list:', error);
    return { error: 'Failed to delete list.' };
  }
}

// --- MOVIE OPERATIONS ---

/**
 * Adds a movie to a specific list.
 * Supports collaborative lists - user can be owner or collaborator.
 */
export async function addMovieToList(formData: FormData) {
  const db = getDb();

  try {
    // AUDIT.md Phase 1 (FormData variant): identity comes from a verified token
    // carried in the FormData, NOT a client-supplied 'userId' field.
    const auth = await verifyCaller(formData.get('idToken'));
    if (isAuthError(auth)) return auth;
    const userId = auth.uid;

    const movieData = JSON.parse(formData.get('movieData') as string) as SearchResult;
    const listId = formData.get('listId') as string;
    const socialLink = formData.get('socialLink') as string;
    const note = formData.get('note') as string;
    const status = (formData.get('status') as 'To Watch' | 'Watched') || 'To Watch';
    // listOwnerId is required for collaborative lists, defaults to userId for backwards compatibility
    const listOwnerId = (formData.get('listOwnerId') as string) || userId;

    if (!movieData || !userId || !listId) {
      throw new Error('Missing movie data, user ID, or list ID.');
    }

    // Check if user can edit this list (owner or collaborator)
    const canEdit = await canEditList(userId, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to add movies to this list.' };
    }

    // Fetch user profile for denormalization (eliminates N+1 fetches on list render)
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Use prefixed ID to distinguish movies and TV shows with same TMDB ID
    const mediaType = movieData.mediaType || 'movie';
    const docId = `${mediaType}_${movieData.id}`;

    const movieRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .doc(docId);

    // Build the movie document with denormalized user data
    // AUDIT.md 2.2 (found via the movieCount race test): Firestore Admin
    // REJECTS undefined field values — a TMDB result missing posterHint (or any
    // raw string field) made `addMovieToList` hard-fail with "Failed to add
    // movie" for real users. Coalesce every raw field to a Firestore-safe value;
    // when present this is a no-op, when absent it stores null instead of crashing.
    const movieDoc: Record<string, unknown> = {
      id: docId,
      title: movieData.title ?? null,
      year: movieData.year ?? null,
      posterUrl: movieData.posterUrl ?? null,
      posterHint: movieData.posterHint ?? null,
      mediaType: mediaType,
      addedBy: userId,
      // Denormalized user data to avoid N+1 fetches
      addedByDisplayName: userData?.displayName || null,
      addedByPhotoURL: userData?.photoURL || null,
      addedByUsername: userData?.username || null,
      socialLink: socialLink || '',
      status: status,
      createdAt: FieldValue.serverTimestamp(),
      // Store TMDB data at write time
      tmdbId: movieData.tmdbId || parseInt(movieData.id, 10) || null,
      overview: movieData.overview || null,
      rating: movieData.rating || null,
      backdropUrl: movieData.backdropUrl || null,
    };

    // Add user note if provided (stored in a notes map keyed by userId)
    if (note) {
      movieDoc.notes = {
        [userId]: note,
      };
    }

    const listRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId);

    // AUDIT.md 2.2: the movie write and the movieCount increment must be
    // atomic. They used to be separate ops — a mid-operation failure drifted
    // the count, and two concurrent adds of the SAME movie both read
    // "not exists" and double-incremented. One transaction makes the
    // existence-check + set + count-change a single unit; Firestore's
    // contention retry collapses the concurrent-add race to one increment.
    const isNewMovie = await db.runTransaction(async (tx) => {
      const existing = await tx.get(movieRef);
      const isNew = !existing.exists;
      tx.set(movieRef, movieDoc, { merge: true });
      tx.update(listRef, {
        updatedAt: FieldValue.serverTimestamp(),
        ...(isNew ? { movieCount: FieldValue.increment(1) } : {}),
      });
      return isNew;
    });

    // Best-effort activity for genuinely new additions — post-commit so its
    // failure can neither roll back nor fail the add.
    if (isNewMovie) {
      try {
        const listDoc = await listRef.get();
        const listData = listDoc.data();
        await createActivity(db, {
          userId,
          type: 'added',
          tmdbId: movieData.tmdbId || parseInt(movieData.id, 10) || 0,
          movieTitle: movieData.title,
          moviePosterUrl: movieData.posterUrl || null,
          movieYear: movieData.year,
          mediaType: mediaType,
          listId,
          listName: listData?.name || 'Watchlist',
        });
      } catch (activityError) {
        console.error('[addMovieToList] Failed to create activity:', activityError);
        // Don't fail the whole operation if activity creation fails
      }
    }

    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to add movie:', error);
    return { error: 'Failed to add movie.' };
  }
}

/**
 * Removes a movie from a list.
 * Supports collaborative lists - user can be owner or collaborator.
 */
export async function removeMovieFromList(
  idToken: string,
  listOwnerId: string,
  listId: string,
  movieId: string
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Check if user can edit this list (owner or collaborator)
    const canEdit = await canEditList(userId, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to remove movies from this list.' };
    }

    const listRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId);
    const movieRef = listRef.collection('movies').doc(movieId);

    // AUDIT.md 2.2: only decrement when an actual delete happens, atomically.
    // The old code always `increment(-1)` even if the movie was already gone
    // (double-tap remove / stale UI) → movieCount drifted negative. The
    // transaction makes "the doc existed → delete it AND decrement" one unit;
    // if it's already gone, it's a clean no-op.
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(movieRef);
      if (!existing.exists) return; // nothing to remove — do not decrement
      tx.delete(movieRef);
      tx.update(listRef, {
        updatedAt: FieldValue.serverTimestamp(),
        movieCount: FieldValue.increment(-1),
      });
    });

    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to remove movie:', error);
    return { error: 'Failed to remove movie.' };
  }
}

/**
 * Update a movie's status in a list.
 * Supports collaborative lists - user can be owner or collaborator.
 */
export async function updateMovieStatus(
  idToken: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
  status: 'To Watch' | 'Watched'
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Check if user can edit this list (owner or collaborator)
    const canEdit = await canEditList(userId, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to update movies in this list.' };
    }

    const movieRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .doc(movieId);

    // Get movie data before update for activity creation
    const movieDoc = await movieRef.get();
    const movieData = movieDoc.data();

    await movieRef.update({
      status,
    });

    // Update list's updatedAt
    await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .update({
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Create 'watched' activity when marking as Watched
    if (status === 'Watched' && movieData) {
      try {
        await createActivity(db, {
          userId,
          type: 'watched',
          tmdbId: movieData.tmdbId || 0,
          movieTitle: movieData.title || 'Unknown',
          moviePosterUrl: movieData.posterUrl || null,
          movieYear: movieData.year || '',
          mediaType: movieData.mediaType || 'movie',
        });
      } catch (activityError) {
        console.error('[updateMovieStatus] Failed to create activity:', activityError);
      }
    }

    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to update movie status:', error);
    return { error: 'Failed to update movie status.' };
  }
}

/**
 * Update a user's note on a movie.
 * Notes are stored per-user in the movie document.
 */
export async function updateMovieNote(
  idToken: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
  note: string
) {
  // AUDIT.md 1.6: note was keyed `notes.${userId}` with a client-supplied
  // userId — a collaborator could spoof or delete ANOTHER member's note.
  // Keyed to the verified caller now: you can only ever touch your own note.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Check if user can edit this list (owner or collaborator)
    const canEdit = await canEditList(userId, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to add notes in this list.' };
    }

    const movieRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .doc(movieId);

    // Use dot notation to update only this user's note
    const noteKey = `notes.${userId}`;
    const noteAuthorKey = `noteAuthors.${userId}`;

    if (note.trim() === '') {
      // Remove the note and author info if empty
      await movieRef.update({
        [noteKey]: FieldValue.delete(),
        [noteAuthorKey]: FieldValue.delete(),
      });
    } else {
      // Fetch user profile for denormalization
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : null;

      // Set or update the note with author info
      await movieRef.update({
        [noteKey]: note.trim(),
        [noteAuthorKey]: {
          username: userData?.username || null,
          displayName: userData?.displayName || null,
          photoURL: userData?.photoURL || null,
        },
      });
    }

    // Update list's updatedAt
    await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .update({
        updatedAt: FieldValue.serverTimestamp(),
      });

    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to update movie note:', error);
    return { error: 'Failed to update movie note.' };
  }
}

// Legacy addMovie() removed (AUDIT.md 4.3 / Phase 1): dead code, no callers,
// and was a reachable POST endpoint that trusted a client-supplied addedBy.
/**
 * Migrates movies from the old structure to a list.
 * Old: users/{userId}/movies/{movieId}
 * New: users/{userId}/lists/{listId}/movies/{movieId}
 */
export async function migrateMoviesToList(idToken: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const oldMoviesRef = db.collection('users').doc(userId).collection('movies');
    const oldMoviesSnapshot = await oldMoviesRef.get();

    if (oldMoviesSnapshot.empty) {
      return { success: true, migratedCount: 0 };
    }

    const batch = db.batch();
    const newMoviesRef = db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .doc(listId)
      .collection('movies');

    oldMoviesSnapshot.docs.forEach((doc) => {
      const movieData = doc.data();
      // Copy to new location
      batch.set(newMoviesRef.doc(doc.id), movieData);
      // Delete from old location
      batch.delete(doc.ref);
    });

    await batch.commit();

    revalidatePath('/');
    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);

    return { success: true, migratedCount: oldMoviesSnapshot.size };
  } catch (error) {
    console.error('Failed to migrate movies:', error);
    return { error: 'Failed to migrate movies.' };
  }
}

// --- SOCIAL FEATURES ---

/**
 * Search for users by username, email, or display name.
 * Also migrates users missing normalized fields on-the-fly.
 */
export async function searchUsers(query: string, currentUserId?: string) {
  // AUDIT.md 2.8: this used to fetch EVERY user doc on every keystroke and
  // filter client-side — at 5k users that's ~5MB per character typed. Now: two
  // parallel single-field prefix-range queries (Firestore auto-indexes
  // single fields, so no composite index needed), each limited. Per-keystroke
  // cost goes from O(total users) to at most ~40 reads.
  // 1.9 note: email is no longer on the public /users doc, so we don't search
  // it (intentional privacy decision — you can't find people by email).
  // Legacy users without usernameLower/displayNameLower won't appear in
  // search until `backfillUserSearchFields` is run — same pre-launch
  // operational task as backfillEmailPrivacy.
  const db = getDb();

  try {
    if (!query || query.length < 2) {
      return { users: [] };
    }

    const q = query.toLowerCase().trim();
    // Classic Firestore prefix-range pattern: [q, q + '') matches every
    // string starting with q ( is a high-codepoint sentinel).
    const upper = q + '';
    const PER_FIELD_LIMIT = 20;

    const [byUsername, byDisplayName] = await Promise.all([
      db.collection('users')
        .where('usernameLower', '>=', q)
        .where('usernameLower', '<', upper)
        .limit(PER_FIELD_LIMIT)
        .get(),
      db.collection('users')
        .where('displayNameLower', '>=', q)
        .where('displayNameLower', '<', upper)
        .limit(PER_FIELD_LIMIT)
        .get(),
    ]);

    const usersMap = new Map<string, UserProfile>();
    const collect = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const data = doc.data();
      const docUid = data.uid || doc.id;
      if (docUid === currentUserId) return;
      if (usersMap.has(docUid)) return;
      usersMap.set(docUid, {
        uid: docUid,
        email: '', // 1.9: email lives in /users_private, never returned here
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        username: data.username || null,
        bio: data.bio || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        followersCount: data.followersCount || 0,
        followingCount: data.followingCount || 0,
      });
    };
    byUsername.docs.forEach(collect);
    byDisplayName.docs.forEach(collect);

    // LAUNCH 0.5.5: blocked users (either direction) never appear in search.
    let blockSet = new Set<string>();
    if (currentUserId) {
      blockSet = await getBlockSet(db, currentUserId);
    }

    // Rank: exact @handle match > @handle prefix > alphabetical.
    const users = Array.from(usersMap.values())
      .filter((u) => !blockSet.has(u.uid) && u.uid !== currentUserId)
      .sort((a, b) => {
        const au = (a.username || '').toLowerCase();
        const bu = (b.username || '').toLowerCase();
        if (au === q && bu !== q) return -1;
        if (bu === q && au !== q) return 1;
        if (au.startsWith(q) && !bu.startsWith(q)) return -1;
        if (bu.startsWith(q) && !au.startsWith(q)) return 1;
        return au.localeCompare(bu);
      })
      .slice(0, 10);

    return { users };
  } catch (error) {
    console.error('[searchUsers] Failed:', error);
    return { error: 'Failed to search users.', users: [] };
  }
}

/**
 * Get a user's profile by ID.
 */
export async function getUserProfile(userId: string) {
  if (!userId) {
    console.error('[getUserProfile] No userId provided');
    return { error: 'No user ID provided.' };
  }

  const db = getDb();

  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      console.log(`[getUserProfile] User not found: ${userId}`);
      return { error: 'User not found.' };
    }

    const userData = userDoc.data();
    // Convert Firestore Timestamp to ISO string for serialization
    return {
      user: {
        uid: userData?.uid || userId,
        email: userData?.email || '',
        displayName: userData?.displayName || null,
        photoURL: userData?.photoURL || null,
        username: userData?.username || null,
        createdAt: userData?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        followersCount: userData?.followersCount || 0,
        followingCount: userData?.followingCount || 0,
      } as UserProfile
    };
  } catch (error) {
    console.error('[getUserProfile] Failed:', error);
    return { error: 'Failed to get user profile.' };
  }
}

/**
 * Get a user's profile by username.
 * Uses indexed queries only - requires usernameLower field to be populated.
 */
export async function getUserByUsername(username: string) {
  const db = getDb();
  const normalizedUsername = username.toLowerCase().trim();

  console.log(`[getUserByUsername] Looking for username: "${normalizedUsername}"`);

  try {
    // Try to find by usernameLower (preferred, normalized field)
    let usersSnapshot = await db.collection('users')
      .where('usernameLower', '==', normalizedUsername)
      .limit(1)
      .get();

    // Fallback: try the username field directly (for backwards compatibility)
    if (usersSnapshot.empty) {
      console.log(`[getUserByUsername] Not found by usernameLower, trying username field`);
      usersSnapshot = await db.collection('users')
        .where('username', '==', normalizedUsername)
        .limit(1)
        .get();
    }

    if (usersSnapshot.empty) {
      console.log(`[getUserByUsername] User not found: "${normalizedUsername}"`);
      return { error: 'User not found.' };
    }

    const doc = usersSnapshot.docs[0];
    const data = doc.data();
    console.log(`[getUserByUsername] Found user: ${doc.id}`);

    // If this user is missing usernameLower, migrate them on read
    if (!data.usernameLower && data.username) {
      console.log(`[getUserByUsername] Migrating user ${doc.id} to add usernameLower`);
      await db.collection('users').doc(doc.id).update({
        usernameLower: data.username.toLowerCase(),
        emailLower: (data.email || '').toLowerCase(),
        displayNameLower: (data.displayName || '').toLowerCase() || null,
      });
    }

    // Convert Firestore Timestamp to ISO string for serialization
    return {
      user: {
        uid: data.uid || doc.id,
        email: data.email || '',
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        username: data.username || null,
        bio: data.bio || null,
        favoriteMovies: data.favoriteMovies || [],
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        followersCount: data.followersCount || 0,
        followingCount: data.followingCount || 0,
      } as UserProfile
    };
  } catch (error) {
    console.error('[getUserByUsername] Failed:', error);
    return { error: 'Failed to get user by username.' };
  }
}

/**
 * Update a user's username.
 */
/**
 * AUDIT.md 2.3 (Option A): usernames are IMMUTABLE for users — frozen at
 * signup. This eliminates the worst denormalization-staleness class (stale
 * @handles breaking profile URLs / @mentions / search). It is intentionally
 * NOT user-callable: it is an ADMIN escape hatch (trademark/abuse/typo support
 * tickets) gated by ADMIN_SECRET, same hardened pattern as backfill actions
 * (1.8). The transactional username/usernameLower/reservation logic from 1.10
 * is preserved — it just runs on an admin-supplied target uid now.
 */
export async function updateUsername(adminSecret: string, userId: string, newUsername: string) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || adminSecret !== expected) {
    return { error: 'Unauthorized' };
  }

  const db = getDb();

  try {
    const username = newUsername.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (username.length < 3) {
      return { error: 'Username must be at least 3 characters.' };
    }

    if (username.length > 20) {
      return { error: 'Username must be 20 characters or less.' };
    }

    const result = await db.runTransaction(async (tx) => {
      const newResRef = db.collection('usernames').doc(username);
      const userRef = db.collection('users').doc(userId);

      const [newResSnap, userSnap] = await Promise.all([tx.get(newResRef), tx.get(userRef)]);

      // Reservation owned by someone else → taken. (If unreserved, the
      // collection-group query below is the correctness backstop for legacy
      // users created before reservations were maintained.)
      if (newResSnap.exists && newResSnap.data()?.uid !== userId) {
        return { error: 'Username is already taken.' };
      }
      if (!userSnap.exists) {
        return { error: 'User not found.' };
      }

      // Backstop for legacy users without a reservation doc.
      const clash = await tx.get(
        db.collection('users').where('usernameLower', '==', username).limit(1)
      );
      if (!clash.empty && clash.docs[0].id !== userId) {
        return { error: 'Username is already taken.' };
      }

      const oldLower: string | undefined = userSnap.data()?.usernameLower;

      tx.update(userRef, { username, usernameLower: username });
      tx.set(newResRef, { uid: userId });
      if (oldLower && oldLower !== username) {
        tx.delete(db.collection('usernames').doc(oldLower));
      }
      return { success: true as const, username };
    });

    if ('error' in result) return result;

    revalidatePath('/profile');
    return result;
  } catch (error) {
    console.error('Failed to update username:', error);
    return { error: 'Failed to update username.' };
  }
}

/**
 * Delete a user account and all associated data.
 * This is a destructive operation that cannot be undone.
 */
export async function deleteUserAccount(idToken: string, confirmUsername: string) {
  // AUDIT.md 1.2 (CRITICAL): the old auth was "username matches userId's stored
  // username" — but usernames are PUBLIC, so anyone could delete anyone by
  // passing (victimUid, victimUsername). Identity now comes from the verified
  // token (checkRevoked for this highest-stakes op); the username check is
  // demoted to a typed "are you sure" confirmation against the caller's OWN name.
  const authRes = await verifyCaller(idToken, { checkRevoked: true });
  if (isAuthError(authRes)) return authRes;
  const userId = authRes.uid;

  const db = getDb();
  const adminApp = getFirebaseAdminApp();
  const auth = getAuth(adminApp);

  try {
    // Verify the user exists and the typed confirmation matches THEIR own name.
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { error: 'User not found.' };
    }

    const userData = userDoc.data();
    const actualUsername = userData?.username?.toLowerCase();
    const providedUsername = confirmUsername.toLowerCase().trim();

    if (actualUsername !== providedUsername) {
      return { error: 'Username does not match. Please enter your exact username to confirm deletion.' };
    }

    console.log(`[deleteUserAccount] Starting deletion for user: ${userId}`);

    // 1. Delete all user's reviews
    const reviewsSnapshot = await db.collection('reviews')
      .where('userId', '==', userId)
      .get();

    const reviewBatch = db.batch();
    let reviewCount = 0;
    for (const doc of reviewsSnapshot.docs) {
      reviewBatch.delete(doc.ref);
      reviewCount++;
      if (reviewCount >= 450) {
        await reviewBatch.commit();
        reviewCount = 0;
      }
    }
    if (reviewCount > 0) {
      await reviewBatch.commit();
    }
    console.log(`[deleteUserAccount] Deleted ${reviewsSnapshot.size} reviews`);

    // 2. Delete all user's ratings
    const ratingsSnapshot = await db.collection('ratings')
      .where('userId', '==', userId)
      .get();

    const ratingBatch = db.batch();
    let ratingCount = 0;
    for (const doc of ratingsSnapshot.docs) {
      ratingBatch.delete(doc.ref);
      ratingCount++;
      if (ratingCount >= 450) {
        await ratingBatch.commit();
        ratingCount = 0;
      }
    }
    if (ratingCount > 0) {
      await ratingBatch.commit();
    }
    console.log(`[deleteUserAccount] Deleted ${ratingsSnapshot.size} ratings`);

    // 3. Delete all user's invites (sent and received)
    const sentInvitesSnapshot = await db.collection('invites')
      .where('inviterId', '==', userId)
      .get();
    const receivedInvitesSnapshot = await db.collection('invites')
      .where('inviteeId', '==', userId)
      .get();

    const inviteBatch = db.batch();
    for (const doc of sentInvitesSnapshot.docs) {
      inviteBatch.delete(doc.ref);
    }
    for (const doc of receivedInvitesSnapshot.docs) {
      inviteBatch.delete(doc.ref);
    }
    await inviteBatch.commit();
    console.log(`[deleteUserAccount] Deleted invites`);

    // 4. Remove user from any lists they collaborate on.
    // AUDIT.md 2.7: was a full `users` scan — O(total users) reads per delete,
    // ~30s+ at 10k users, exceeds function timeouts, half-deletes accounts on
    // timeout. Switched to a single collectionGroup query that returns ONLY
    // the lists actually containing this user (O(collaborator-lists)).
    // Requires the `lists`/`collaboratorIds` collection-group field override
    // in firestore.indexes.json.
    const collabLists = await db
      .collectionGroup('lists')
      .where('collaboratorIds', 'array-contains', userId)
      .get();

    let collabBatch = db.batch();
    let collabBatchSize = 0;
    for (const listDoc of collabLists.docs) {
      // Skip lists owned by the user being deleted — those are removed
      // outright in step 5; arrayRemove there would be redundant.
      if (listDoc.ref.parent.parent?.id === userId) continue;
      collabBatch.update(listDoc.ref, {
        collaboratorIds: FieldValue.arrayRemove(userId),
      });
      collabBatchSize++;
      if (collabBatchSize >= 450) {
        await collabBatch.commit();
        collabBatch = db.batch();
        collabBatchSize = 0;
      }
    }
    if (collabBatchSize > 0) await collabBatch.commit();
    console.log(`[deleteUserAccount] Removed from ${collabLists.size} collaborations`);

    // 5. Delete all user's lists and their movies (subcollections)
    const userListsSnapshot = await db.collection('users').doc(userId).collection('lists').get();
    for (const listDoc of userListsSnapshot.docs) {
      // Delete movies in the list first
      const moviesSnapshot = await listDoc.ref.collection('movies').get();
      const movieBatch = db.batch();
      let movieCount = 0;
      for (const movieDoc of moviesSnapshot.docs) {
        movieBatch.delete(movieDoc.ref);
        movieCount++;
        if (movieCount >= 450) {
          await movieBatch.commit();
          movieCount = 0;
        }
      }
      if (movieCount > 0) {
        await movieBatch.commit();
      }
      // Then delete the list
      await listDoc.ref.delete();
    }
    console.log(`[deleteUserAccount] Deleted ${userListsSnapshot.size} lists`);

    // 6. Delete follower/following relationships
    // Delete user's followers subcollection
    const followersSnapshot = await db.collection('users').doc(userId).collection('followers').get();
    for (const followerDoc of followersSnapshot.docs) {
      // Also remove from the other user's following list
      const followerId = followerDoc.id;
      await db.collection('users').doc(followerId).collection('following').doc(userId).delete();
      // Update follower's count
      await db.collection('users').doc(followerId).update({
        followingCount: FieldValue.increment(-1),
      });
      await followerDoc.ref.delete();
    }

    // Delete user's following subcollection
    const followingSnapshot = await db.collection('users').doc(userId).collection('following').get();
    for (const followingDoc of followingSnapshot.docs) {
      // Also remove from the other user's followers list
      const followingId = followingDoc.id;
      await db.collection('users').doc(followingId).collection('followers').doc(userId).delete();
      // Update following's count
      await db.collection('users').doc(followingId).update({
        followersCount: FieldValue.increment(-1),
      });
      await followingDoc.ref.delete();
    }
    console.log(`[deleteUserAccount] Deleted follow relationships`);

    // 7. Delete username reservation
    if (userData?.username) {
      await db.collection('usernames').doc(userData.username).delete();
    }
    console.log(`[deleteUserAccount] Deleted username reservation`);

    // 8. Delete the user document
    await db.collection('users').doc(userId).delete();
    console.log(`[deleteUserAccount] Deleted user document`);

    // 9. Delete Firebase Auth user
    try {
      await auth.deleteUser(userId);
      console.log(`[deleteUserAccount] Deleted Firebase Auth user`);
    } catch (authError: any) {
      // Auth user might not exist or already deleted
      console.error(`[deleteUserAccount] Auth deletion error (non-fatal):`, authError.message);
    }

    console.log(`[deleteUserAccount] Successfully deleted account for user: ${userId}`);
    return { success: true };
  } catch (error: any) {
    console.error('[deleteUserAccount] Failed:', error);
    return { error: error.message || 'Failed to delete account. Please try again.' };
  }
}

/**
 * Follow a user.
 */
export async function followUser(idToken: string, followingId: string) {
  // AUDIT.md Phase 1: actor identity from verified token, not a client param.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const followerId = auth.uid;

  // AUDIT.md 3.8: cap scripted follow/notification spam.
  const rl = await checkRateLimit(followerId, 'follow');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    if (followerId === followingId) {
      return { error: "You can't follow yourself." };
    }

    // LAUNCH 0.5.5: a block in either direction severs interaction.
    if (await isBlockedBetween(db, followerId, followingId)) {
      return { error: 'Unable to follow this user.' };
    }

    // Check if already following
    const existingFollow = await db
      .collection('users')
      .doc(followerId)
      .collection('following')
      .doc(followingId)
      .get();

    if (existingFollow.exists) {
      return { error: 'Already following this user.' };
    }

    const batch = db.batch();

    // Add to follower's following list
    batch.set(
      db.collection('users').doc(followerId).collection('following').doc(followingId),
      {
        id: followingId,
        followerId: followerId,
        followingId: followingId,
        createdAt: FieldValue.serverTimestamp(),
      }
    );

    // Add to target's followers list
    batch.set(
      db.collection('users').doc(followingId).collection('followers').doc(followerId),
      {
        id: followerId,
        followerId: followerId,
        followingId: followingId,
        createdAt: FieldValue.serverTimestamp(),
      }
    );

    // Update counts
    batch.update(db.collection('users').doc(followerId), {
      followingCount: FieldValue.increment(1),
    });

    batch.update(db.collection('users').doc(followingId), {
      followersCount: FieldValue.increment(1),
    });

    await batch.commit();

    // Create follow notification
    try {
      // Check if user has follows notifications enabled
      const followedUserDoc = await db.collection('users').doc(followingId).get();
      const followedUserData = followedUserDoc.data();
      const prefs = followedUserData?.notificationPreferences;

      // Only create notification if follows are enabled (default true)
      if (!prefs || prefs.follows !== false) {
        const followerDoc = await db.collection('users').doc(followerId).get();
        const followerData = followerDoc.data();

        await db.collection('notifications').add({
          userId: followingId, // Recipient (the person being followed)
          type: 'follow',
          fromUserId: followerId,
          fromUsername: followerData?.username || null,
          fromDisplayName: followerData?.displayName || null,
          fromPhotoUrl: followerData?.photoURL || null,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('[followUser] Failed to create notification:', err);
    }

    revalidatePath('/profile');
    revalidatePath(`/profile/${followingId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to follow user:', error);
    return { error: 'Failed to follow user.' };
  }
}

/**
 * Unfollow a user.
 */
export async function unfollowUser(idToken: string, followingId: string) {
  // AUDIT.md Phase 1: actor identity from verified token, not a client param.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const followerId = auth.uid;

  const db = getDb();

  try {
    const batch = db.batch();

    // Remove from follower's following list
    batch.delete(
      db.collection('users').doc(followerId).collection('following').doc(followingId)
    );

    // Remove from target's followers list
    batch.delete(
      db.collection('users').doc(followingId).collection('followers').doc(followerId)
    );

    // Update counts
    batch.update(db.collection('users').doc(followerId), {
      followingCount: FieldValue.increment(-1),
    });

    batch.update(db.collection('users').doc(followingId), {
      followersCount: FieldValue.increment(-1),
    });

    await batch.commit();

    revalidatePath('/profile');
    revalidatePath(`/profile/${followingId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to unfollow user:', error);
    return { error: 'Failed to unfollow user.' };
  }
}

/**
 * Check if a user is following another user.
 */
export async function isFollowing(followerId: string, followingId: string) {
  const db = getDb();

  try {
    const followDoc = await db
      .collection('users')
      .doc(followerId)
      .collection('following')
      .doc(followingId)
      .get();

    return { isFollowing: followDoc.exists };
  } catch (error) {
    console.error('Failed to check follow status:', error);
    return { error: 'Failed to check follow status.' };
  }
}

/**
 * Get a user's followers.
 */
export async function getFollowers(userId: string, limit: number = 50) {
  const db = getDb();

  try {
    // Try without orderBy first (doesn't require index)
    const followersSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('followers')
      .limit(limit)
      .get();

    console.log(`[getFollowers] Found ${followersSnapshot.size} followers for user ${userId}`);

    if (followersSnapshot.empty) {
      return { users: [] };
    }

    // Get user profiles for each follower
    const followerIds = followersSnapshot.docs.map((doc) => doc.id);
    const users: UserProfile[] = [];

    for (const id of followerIds) {
      const userDoc = await db.collection('users').doc(id).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        // Convert Firestore Timestamp to ISO string for serialization
        users.push({
          uid: data?.uid || id,
          email: data?.email || '',
          displayName: data?.displayName || null,
          photoURL: data?.photoURL || null,
          username: data?.username || null,
          bio: data?.bio || null,
          createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          followersCount: data?.followersCount || 0,
          followingCount: data?.followingCount || 0,
        });
      }
    }

    console.log(`[getFollowers] Returning ${users.length} user profiles`);
    return { users };
  } catch (error) {
    console.error('[getFollowers] Failed:', error);
    return { error: 'Failed to get followers.', users: [] };
  }
}

/**
 * Get users that a user is following.
 */
export async function getFollowing(userId: string, limit: number = 50) {
  const db = getDb();

  try {
    // Try without orderBy first (doesn't require index)
    const followingSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('following')
      .limit(limit)
      .get();

    console.log(`[getFollowing] Found ${followingSnapshot.size} following for user ${userId}`);

    if (followingSnapshot.empty) {
      return { users: [] };
    }

    // Get user profiles for each following
    const followingIds = followingSnapshot.docs.map((doc) => doc.id);
    const users: UserProfile[] = [];

    for (const id of followingIds) {
      const userDoc = await db.collection('users').doc(id).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        // Convert Firestore Timestamp to ISO string for serialization
        users.push({
          uid: data?.uid || id,
          email: data?.email || '',
          displayName: data?.displayName || null,
          photoURL: data?.photoURL || null,
          username: data?.username || null,
          bio: data?.bio || null,
          createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          followersCount: data?.followersCount || 0,
          followingCount: data?.followingCount || 0,
        });
      }
    }

    console.log(`[getFollowing] Returning ${users.length} user profiles`);
    return { users };
  } catch (error) {
    console.error('[getFollowing] Failed:', error);
    return { error: 'Failed to get following.', users: [] };
  }
}

/**
 * Get a user's public lists (for viewing by others).
 */
export async function getUserPublicLists(userId: string) {
  const db = getDb();

  try {
    // Query without orderBy to avoid needing a composite index
    const listsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .where('isPublic', '==', true)
      .get();

    const lists = listsSnapshot.docs.map((doc) => {
      const data = doc.data();
      // Convert Firestore Timestamps to ISO strings for serialization
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
        _sortTime: data.updatedAt?.toDate?.()?.getTime?.() || 0,
      };
    });

    // Sort client-side by updatedAt descending
    lists.sort((a, b) => b._sortTime - a._sortTime);

    // Remove the temporary sort field before returning
    const cleanedLists = lists.map(({ _sortTime, ...rest }) => rest);

    return { lists: cleanedLists };
  } catch (error) {
    console.error('Failed to get public lists:', error);
    return { error: 'Failed to get public lists.' };
  }
}

/**
 * A public list rendered as a discovery card (showcase + list search).
 */
export type LovedListCard = {
  id: string;
  name: string;
  ownerId: string;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  coverImageUrl: string;
  movieCount: number;
  likes: number;
  previewPosters: string[];
};

/**
 * Turn raw list docs into discovery cards — batch-fetches owner profiles and
 * up to 4 preview posters per list. Shared by getLovedLists + searchPublicLists.
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
        movieCount: typeof d.movieCount === 'number' ? d.movieCount : previewPosters.length,
        likes: d.likes || 0,
        previewPosters,
      };
    }),
  );
}

/**
 * The loved-lists showcase (LAUNCH 0.5.2).
 *
 * Collection-group query over every public list, candidate set ordered by raw
 * `likes`, then re-ranked in memory by a recency-weighted "hot" score so a list
 * that camped the top months ago can't ossify there. Editorial — not a
 * leaderboard, no ranks.
 *
 * Cold-start gated: returns `{ lists: [], gated: true }` until at least
 * MIN_LOVED_LISTS public lists have been liked, so it never renders empty.
 */
export async function getLovedLists(limit = 12) {
  const MIN_LOVED_LISTS = 3;
  const db = getDb();
  try {
    const snap = await db
      .collectionGroup('lists')
      .where('isPublic', '==', true)
      .where('likes', '>', 0)
      .orderBy('likes', 'desc')
      .limit(60)
      .get();

    if (snap.size < MIN_LOVED_LISTS) {
      return { lists: [] as LovedListCard[], gated: true };
    }

    const now = Date.now();
    const ranked = snap.docs
      .map((doc) => {
        const d = doc.data();
        const likes: number = d.likes || 0;
        const lastMs =
          d.lastLikedAt?.toMillis?.() ?? d.createdAt?.toMillis?.() ?? now;
        const ageHours = Math.max(0, (now - lastMs) / 3_600_000);
        // Recency-weighted: likes decay as a list goes quiet.
        return { doc, score: likes / Math.pow(ageHours + 2, 1.5) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.doc);

    const lists = await hydrateListCards(db, ranked);
    return { lists, gated: false };
  } catch (error) {
    console.error('[getLovedLists] Failed:', error);
    return { lists: [] as LovedListCard[], gated: false, error: 'Failed to load loved lists.' };
  }
}

/**
 * Search public lists by name (LAUNCH 0.5.3 — the Home search overlay).
 *
 * In-memory substring match over the public-list collection group. Fine while
 * the dataset is small (the launch-plan's stated approach); swap to a
 * `nameLower` prefix index if list volume grows.
 */
export async function searchPublicLists(query: string, limit = 12) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { lists: [] as LovedListCard[] };
  const db = getDb();
  try {
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
  } catch (error) {
    console.error('[searchPublicLists] Failed:', error);
    return { lists: [] as LovedListCard[], error: 'Failed to search lists.' };
  }
}

/**
 * Get movies from a list.
 * Allows access if: list is public, viewer is owner, or viewer is collaborator.
 */
export async function getPublicListMovies(ownerId: string, listId: string, viewerId: string) {
  const db = getDb();

  try {
    // Check if list exists
    const listDoc = await db
      .collection('users')
      .doc(ownerId)
      .collection('lists')
      .doc(listId)
      .get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Allow access if: public, owner, or collaborator
    const isOwner = ownerId === viewerId;
    const isCollaborator = collaboratorIds.includes(viewerId);
    const isPublic = listData?.isPublic;

    if (!isPublic && !isOwner && !isCollaborator) {
      return { error: 'This list is private.' };
    }

    const moviesSnapshot = await db
      .collection('users')
      .doc(ownerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .orderBy('createdAt', 'desc')
      .get();

    // Convert Firestore Timestamps to ISO strings for serialization
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

    // Serialize list data
    const serializedList = {
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
    };

    return {
      list: serializedList,
      movies,
      isCollaborator: isCollaborator && !isOwner, // For UI to know user's role
    };
  } catch (error) {
    console.error('Failed to get public list movies:', error);
    return { error: 'Failed to get list movies.' };
  }
}

/**
 * Toggle a list's public/private status.
 * Only the list owner can change visibility.
 */
export async function toggleListVisibility(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Only owner can change visibility
    if (userId !== listOwnerId) {
      return { error: 'Only the list owner can change visibility.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const currentVisibility = listDoc.data()?.isPublic ?? true;
    await listRef.update({
      isPublic: !currentVisibility,
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true, isPublic: !currentVisibility };
  } catch (error) {
    console.error('Failed to toggle list visibility:', error);
    return { error: 'Failed to toggle list visibility.' };
  }
}

/**
 * AUDIT.md 1.9 migration: move email/emailLower OFF the publicly-readable
 * /users docs of EXISTING users into /users_private, then strip them from the
 * public doc. New users are already split at creation; this closes the leak
 * for legacy data. Admin-gated (same hardened secret check as 1.8). Idempotent.
 */
export async function backfillEmailPrivacy(adminSecret: string) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || adminSecret !== expected) {
    return { error: 'Unauthorized' };
  }

  const db = getDb();
  try {
    const usersSnapshot = await db.collection('users').get();
    let migrated = 0;
    let skipped = 0;

    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      const hasEmail = data.email !== undefined || data.emailLower !== undefined;
      if (!hasEmail) { skipped++; continue; }

      const email: string = data.email || '';
      await db.collection('users_private').doc(doc.id).set({
        uid: doc.id,
        email,
        emailLower: (data.email || data.emailLower || '').toLowerCase(),
      }, { merge: true });

      await doc.ref.update({
        email: FieldValue.delete(),
        emailLower: FieldValue.delete(),
      });
      migrated++;
    }

    return { success: true, migrated, skipped };
  } catch (error) {
    console.error('[backfillEmailPrivacy] Failed:', error);
    return { error: 'Failed to backfill email privacy.' };
  }
}

/**
 * Backfill all users with normalized search fields (usernameLower, emailLower, displayNameLower).
 * This should be run once to migrate existing users. Can be called from an admin page or script.
 * Processes in batches of 400 to stay within Firestore limits.
 */
export async function backfillUserSearchFields() {
  const db = getDb();

  try {
    const usersSnapshot = await db.collection('users').get();
    let migratedCount = 0;
    let skippedCount = 0;

    let batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 400; // Stay under Firestore's 500 limit

    for (const doc of usersSnapshot.docs) {
      const data = doc.data();

      // Skip if already has usernameLower
      if (data.usernameLower) {
        skippedCount++;
        continue;
      }

      // Skip if no username to normalize
      if (!data.username) {
        console.log(`[backfill] User ${doc.id} has no username, skipping`);
        skippedCount++;
        continue;
      }

      const updates: Record<string, string | null> = {
        usernameLower: data.username.toLowerCase(),
        emailLower: (data.email || '').toLowerCase(),
        displayNameLower: data.displayName?.toLowerCase() || null,
      };

      batch.update(doc.ref, updates);
      batchCount++;
      migratedCount++;

      // Commit batch if at limit, then create new batch
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        console.log(`[backfill] Committed batch of ${batchCount} users`);
        batch = db.batch(); // Create new batch - can't reuse after commit
        batchCount = 0;
      }
    }

    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
      console.log(`[backfill] Committed final batch of ${batchCount} users`);
    }

    console.log(`[backfill] Complete. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
    return { success: true, migratedCount, skippedCount };
  } catch (error) {
    console.error('[backfill] Failed:', error);
    return { error: 'Failed to backfill user search fields.' };
  }
}

// --- COLLABORATIVE LISTS ---

const MAX_LIST_MEMBERS = 10; // Owner + 9 collaborators

/**
 * Generate a random invite code for link-based invites.
 */
function generateInviteCode(): string {
  // AUDIT.md 2.9: Math.random() is not a CSPRNG (predictable). randomInt() is
  // cryptographically secure AND rejection-samples internally (no modulo bias).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

/**
 * Check if a user can edit a list (is owner or collaborator).
 */
export async function canEditList(userId: string, listOwnerId: string, listId: string): Promise<boolean> {
  if (userId === listOwnerId) return true;

  const db = getDb();
  const listDoc = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();

  if (!listDoc.exists) return false;

  const collaboratorIds = listDoc.data()?.collaboratorIds || [];
  return collaboratorIds.includes(userId);
}

/**
 * Get list members (owner + collaborators) with profile info.
 */
export async function getListMembers(listOwnerId: string, listId: string) {
  const db = getDb();

  try {
    const listDoc = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();

    if (!listDoc.exists) {
      return { error: 'List not found.', members: [] };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Fetch owner AND all collaborators in PARALLEL
    const allUserIds = [listOwnerId, ...collaboratorIds];
    const userPromises = allUserIds.map(async (userId, index) => {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        return {
          uid: userId,
          username: userData?.username || null,
          displayName: userData?.displayName || null,
          photoURL: userData?.photoURL || null,
          role: index === 0 ? 'owner' as const : 'collaborator' as const,
        };
      }
      return null;
    });

    const results = await Promise.all(userPromises);
    const members = results.filter((m): m is ListMember => m !== null);

    return { members };
  } catch (error) {
    console.error('[getListMembers] Failed:', error);
    return { error: 'Failed to get list members.', members: [] };
  }
}

/**
 * Invite a user to collaborate on a list (in-app invite).
 */
export async function inviteToList(idToken: string, listOwnerId: string, listId: string, inviteeId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const inviterId = auth.uid;

  // AUDIT.md 3.8: cap scripted invite spam.
  const rl = await checkRateLimit(inviterId, 'invite');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    // Get list info first to check permissions
    const listDoc = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Allow owner or collaborators to invite
    const isOwner = inviterId === listOwnerId;
    const isCollaborator = collaboratorIds.includes(inviterId);
    if (!isOwner && !isCollaborator) {
      return { error: 'Only list members can invite collaborators.' };
    }

    // Check max members
    if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
      return { error: `Lists can have a maximum of ${MAX_LIST_MEMBERS} members.` };
    }

    // Check if already a collaborator
    if (collaboratorIds.includes(inviteeId)) {
      return { error: 'User is already a collaborator on this list.' };
    }

    // Check if invitee exists
    const inviteeDoc = await db.collection('users').doc(inviteeId).get();
    if (!inviteeDoc.exists) {
      return { error: 'User not found.' };
    }

    // Get inviter info
    const inviterDoc = await db.collection('users').doc(inviterId).get();
    const inviterData = inviterDoc.data();

    // Check for existing pending invite
    const existingInvite = await db.collection('invites')
      .where('listId', '==', listId)
      .where('listOwnerId', '==', listOwnerId)
      .where('inviteeId', '==', inviteeId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingInvite.empty) {
      return { error: 'An invite is already pending for this user.' };
    }

    // Create invite
    const inviteRef = db.collection('invites').doc();
    const inviteeData = inviteeDoc.data();

    await inviteRef.set({
      id: inviteRef.id,
      listId,
      listName: listData?.name || 'Untitled List',
      listOwnerId,
      inviterId,
      inviterUsername: inviterData?.username || null,
      inviteeId,
      inviteeUsername: inviteeData?.username || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Create list invite notification for the invitee
    try {
      // Check if user has list invite notifications enabled
      const prefs = inviteeData?.notificationPreferences;

      // Only create notification if list invites are enabled (default true)
      if (!prefs || prefs.listInvites !== false) {
        await db.collection('notifications').add({
          userId: inviteeId, // The person being invited
          type: 'list_invite',
          fromUserId: inviterId,
          fromUsername: inviterData?.username || null,
          fromDisplayName: inviterData?.displayName || null,
          fromPhotoUrl: inviterData?.photoURL || null,
          listId,
          listOwnerId,
          listName: listData?.name || 'Untitled List',
          inviteId: inviteRef.id, // For accepting/declining from notification
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('[inviteToList] Failed to create notification:', err);
    }

    return { success: true, inviteId: inviteRef.id };
  } catch (error) {
    console.error('[inviteToList] Failed:', error);
    return { error: 'Failed to send invite.' };
  }
}

/**
 * Create an invite link for a list.
 */
export async function createInviteLink(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const inviterId = auth.uid;

  // AUDIT.md 3.8: cap scripted invite-link generation.
  const rl = await checkRateLimit(inviterId, 'invite');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    // Get list info first to check permissions
    const listDoc = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Allow owner or collaborators to create invite links
    const isOwner = inviterId === listOwnerId;
    const isCollaborator = collaboratorIds.includes(inviterId);
    if (!isOwner && !isCollaborator) {
      return { error: 'Only list members can create invite links.' };
    }

    // Check max members
    if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
      return { error: `Lists can have a maximum of ${MAX_LIST_MEMBERS} members.` };
    }

    // Get inviter info
    const inviterDoc = await db.collection('users').doc(inviterId).get();
    const inviterData = inviterDoc.data();

    // Create invite with code
    const inviteRef = db.collection('invites').doc();
    const inviteCode = generateInviteCode();

    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await inviteRef.set({
      id: inviteRef.id,
      listId,
      listName: listData?.name || 'Untitled List',
      listOwnerId,
      inviterId,
      inviterUsername: inviterData?.username || null,
      inviteCode,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    return { success: true, inviteId: inviteRef.id, inviteCode };
  } catch (error) {
    console.error('[createInviteLink] Failed:', error);
    return { error: 'Failed to create invite link.' };
  }
}

/**
 * Get invite by code (for link-based invites).
 */
export async function getInviteByCode(inviteCode: string) {
  const db = getDb();

  try {
    const inviteSnapshot = await db.collection('invites')
      .where('inviteCode', '==', inviteCode)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (inviteSnapshot.empty) {
      return { error: 'Invite not found or has expired.' };
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const inviteData = inviteDoc.data();

    // Check expiration
    if (inviteData.expiresAt && inviteData.expiresAt.toDate() < new Date()) {
      return { error: 'This invite link has expired.' };
    }

    // Convert Firestore Timestamps to ISO strings for serialization
    return {
      invite: {
        id: inviteDoc.id,
        listId: inviteData.listId,
        listName: inviteData.listName,
        listOwnerId: inviteData.listOwnerId,
        inviterId: inviteData.inviterId,
        inviterUsername: inviteData.inviterUsername,
        inviteCode: inviteData.inviteCode,
        status: inviteData.status,
        createdAt: inviteData.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        expiresAt: inviteData.expiresAt?.toDate?.()?.toISOString?.() || undefined,
      } as ListInvite
    };
  } catch (error) {
    console.error('[getInviteByCode] Failed:', error);
    return { error: 'Failed to get invite.' };
  }
}

/**
 * Get pending invites for a user.
 */
export async function getMyPendingInvites(userId: string) {
  const db = getDb();

  try {
    const invitesSnapshot = await db.collection('invites')
      .where('inviteeId', '==', userId)
      .where('status', '==', 'pending')
      .get();

    const invites: ListInvite[] = invitesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        listId: data.listId,
        listName: data.listName,
        listOwnerId: data.listOwnerId,
        inviterId: data.inviterId,
        inviterUsername: data.inviterUsername,
        inviteeId: data.inviteeId,
        inviteeUsername: data.inviteeUsername,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      };
    });

    return { invites };
  } catch (error) {
    console.error('[getMyPendingInvites] Failed:', error);
    return { error: 'Failed to get invites.', invites: [] };
  }
}

/**
 * Get pending invites for a list (for owner or collaborators to see).
 */
export async function getListPendingInvites(idToken: string, listOwnerId: string, listId: string) {
  // AUDIT.md 1.14: was IDOR/tautological (trusted client userId; passing
  // userId===listOwnerId satisfied isOwner). Now membership is decided by the
  // verified caller. Also: inviteCode is owner-only — a collaborator who is
  // later removed must not walk away with a working join code.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Check if user is owner or collaborator
    const listDoc = await db.collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
    if (!listDoc.exists) {
      return { error: 'List not found.', invites: [] };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];
    const isOwner = userId === listOwnerId;
    const isCollaborator = collaboratorIds.includes(userId);

    if (!isOwner && !isCollaborator) {
      return { error: 'Only list members can view pending invites.', invites: [] };
    }

    const invitesSnapshot = await db.collection('invites')
      .where('listId', '==', listId)
      .where('listOwnerId', '==', listOwnerId)
      .where('status', '==', 'pending')
      .get();

    // Convert Firestore Timestamps to ISO strings for serialization
    const invites: ListInvite[] = invitesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        listId: data.listId,
        listName: data.listName,
        listOwnerId: data.listOwnerId,
        inviterId: data.inviterId,
        inviterUsername: data.inviterUsername,
        inviteeId: data.inviteeId,
        inviteeUsername: data.inviteeUsername,
        // 1.14: only the owner gets the join code.
        inviteCode: isOwner ? data.inviteCode : undefined,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || undefined,
      };
    });

    return { invites };
  } catch (error) {
    console.error('[getListPendingInvites] Failed:', error);
    return { error: 'Failed to get invites.', invites: [] };
  }
}

/**
 * Accept an invite (either by inviteId or inviteCode).
 */
export async function acceptInvite(idToken: string, inviteId?: string, inviteCode?: string) {
  // AUDIT.md 1.11: was IDOR (trusted client userId) + a read-check-write RACE
  // (two concurrent accepts could blow past MAX_LIST_MEMBERS; a concurrent
  // revoke could be ignored). Now: verified token + a single transaction that
  // re-reads invite status and the member count atomically.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Resolve the invite ref (a code lookup is a query; the transaction below
    // re-reads this exact ref, so a stale status here is harmless).
    let inviteRef;
    if (inviteId) {
      inviteRef = db.collection('invites').doc(inviteId);
    } else if (inviteCode) {
      const inviteSnapshot = await db.collection('invites')
        .where('inviteCode', '==', inviteCode)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (inviteSnapshot.empty) {
        return { error: 'Invite not found or has expired.' };
      }
      inviteRef = inviteSnapshot.docs[0].ref;
    } else {
      return { error: 'No invite specified.' };
    }

    const txResult = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { error: 'Invite not found.' };
      const inviteData = inviteSnap.data()!;

      if (inviteData.inviteeId && inviteData.inviteeId !== userId) {
        return { error: 'This invite is for another user.' };
      }
      // Re-checked INSIDE the tx — closes the revoke↔accept race.
      if (inviteData.status !== 'pending') {
        return { error: 'This invite is no longer valid.' };
      }
      if (inviteData.expiresAt && inviteData.expiresAt.toDate() < new Date()) {
        return { error: 'This invite has expired.' };
      }

      const listRef = db.collection('users').doc(inviteData.listOwnerId)
        .collection('lists').doc(inviteData.listId);
      const listSnap = await tx.get(listRef);
      if (!listSnap.exists) return { error: 'List no longer exists.' };

      const collaboratorIds: string[] = listSnap.data()?.collaboratorIds || [];

      if (collaboratorIds.includes(userId) || userId === inviteData.listOwnerId) {
        tx.update(inviteRef, { status: 'accepted' });
        return { error: 'You are already a member of this list.' };
      }

      // Member-cap check now atomic with the write below.
      if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
        return { error: 'This list has reached the maximum number of members.' };
      }

      tx.update(listRef, {
        collaboratorIds: FieldValue.arrayUnion(userId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(inviteRef, { status: 'accepted', inviteeId: userId });

      return { success: true as const, listId: inviteData.listId, listOwnerId: inviteData.listOwnerId };
    });

    // txResult.error is `string` at runtime in this branch; the `| undefined`
    // is only a TS union-normalization artifact (the ok-variant never carries
    // `error`). The cast keeps the function's return type clean.
    if ('error' in txResult) return { error: txResult.error as string };
    const inviteData = { listId: txResult.listId, listOwnerId: txResult.listOwnerId };

    // Delete the associated notification (so Accept/Decline buttons don't show anymore)
    // Query by listId for backwards compatibility (older notifications may not have inviteId)
    try {
      const notificationSnapshot = await db.collection('notifications')
        .where('userId', '==', userId)
        .where('type', '==', 'list_invite')
        .where('listId', '==', inviteData.listId)
        .limit(1)
        .get();

      if (!notificationSnapshot.empty) {
        await notificationSnapshot.docs[0].ref.delete();
      }
    } catch (err) {
      // Non-critical - just log and continue
      console.error('[acceptInvite] Failed to delete notification:', err);
    }

    revalidatePath('/lists');
    return { success: true, listId: inviteData.listId, listOwnerId: inviteData.listOwnerId };
  } catch (error) {
    console.error('[acceptInvite] Failed:', error);
    return { error: 'Failed to accept invite.' };
  }
}

/**
 * Decline an invite.
 */
export async function declineInvite(idToken: string, inviteId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      return { error: 'Invite not found.' };
    }

    const inviteData = inviteDoc.data();

    // Check if invite is for this user
    if (inviteData?.inviteeId !== userId) {
      return { error: 'This invite is for another user.' };
    }

    await inviteRef.update({ status: 'declined' });

    // Delete the associated notification (so Accept/Decline buttons don't show anymore)
    // Query by listId for backwards compatibility (older notifications may not have inviteId)
    try {
      const notificationSnapshot = await db.collection('notifications')
        .where('userId', '==', userId)
        .where('type', '==', 'list_invite')
        .where('listId', '==', inviteData?.listId)
        .limit(1)
        .get();

      if (!notificationSnapshot.empty) {
        await notificationSnapshot.docs[0].ref.delete();
      }
    } catch (err) {
      // Non-critical - just log and continue
      console.error('[declineInvite] Failed to delete notification:', err);
    }

    return { success: true };
  } catch (error) {
    console.error('[declineInvite] Failed:', error);
    return { error: 'Failed to decline invite.' };
  }
}

/**
 * Revoke an invite (owner only).
 */
export async function revokeInvite(idToken: string, inviteId: string) {
  // AUDIT.md 1.12: was IDOR (trusted client userId) + too narrow (only the
  // inviter could revoke; the list owner couldn't revoke a collaborator's
  // invite) + racy vs acceptInvite. Now: verified token, owner-OR-inviter,
  // and the status check + write happen in one transaction.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const inviteRef = db.collection('invites').doc(inviteId);

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { error: 'Invite not found.' };
      const inviteData = inviteSnap.data()!;

      // The inviter OR the list owner may revoke.
      if (inviteData.inviterId !== userId && inviteData.listOwnerId !== userId) {
        return { error: 'Only the list owner or the inviter can revoke this invite.' };
      }
      // Re-checked in-tx: don't revoke an invite that was just accepted.
      if (inviteData.status !== 'pending') {
        return { error: 'This invite is no longer pending.' };
      }

      tx.update(inviteRef, { status: 'revoked' });
      return { success: true as const };
    });

    return result;
  } catch (error) {
    console.error('[revokeInvite] Failed:', error);
    return { error: 'Failed to revoke invite.' };
  }
}

/**
 * Remove a collaborator from a list (owner only).
 */
export async function removeCollaborator(idToken: string, ownerId: string, listId: string, collaboratorId: string) {
  // AUDIT.md 1.4: the old check `listData.ownerId !== ownerId` was tautological
  // (ownerId was both the path AND the comparison target — always passed).
  // Now we compare the stored owner against the cryptographically-verified
  // caller, so only the real owner can remove collaborators.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;

  const db = getDb();

  try {
    const listRef = db.collection('users').doc(ownerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();

    // Only the verified list owner may remove collaborators.
    if (listData?.ownerId !== auth.uid) {
      return { error: 'Only the list owner can remove collaborators.' };
    }

    // Remove collaborator
    await listRef.update({
      collaboratorIds: FieldValue.arrayRemove(collaboratorId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('[removeCollaborator] Failed:', error);
    return { error: 'Failed to remove collaborator.' };
  }
}

/**
 * Leave a list (collaborator only - owner must transfer ownership first).
 */
export async function leaveList(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Owner cannot leave without transferring ownership
    if (userId === listOwnerId) {
      return { error: 'As the owner, you must transfer ownership before leaving or delete the list.' };
    }

    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Check if user is a collaborator
    if (!collaboratorIds.includes(userId)) {
      return { error: 'You are not a collaborator on this list.' };
    }

    // Remove user from collaborators
    await listRef.update({
      collaboratorIds: FieldValue.arrayRemove(userId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    revalidatePath('/lists');
    return { success: true };
  } catch (error) {
    console.error('[leaveList] Failed:', error);
    return { error: 'Failed to leave list.' };
  }
}

/**
 * Transfer list ownership to a collaborator.
 */
export async function transferOwnership(idToken: string, listId: string, newOwnerId: string) {
  // AUDIT.md 1.3 + 2.1.
  // 1.3 (auth): the current owner IS the verified caller; stored ownerId is
  // double-checked inside an atomic pre-flight transaction below.
  // 2.1 (transactional integrity): subcollection moves can't fit in one
  // Firestore transaction (500-op limit), so we use a safer staged pattern:
  //   (P1) atomic pre-flight transaction — verify state ONCE under contention
  //   (P2) batched idempotent copy of movies to the new owner's path
  //   (P3) write the new list doc with the swapped collaborator set
  //   (P4) re-point all relevant /invites docs from old → new owner
  //   (P5) batched delete of old movies
  //   (P6) FINAL delete of the old list doc — the canonical transition point
  // The source list doc stays as the source of truth until P6. A crash
  // anywhere before P6 leaves the source intact and the operation safely
  // re-runnable (all writes are idempotent set/update). The audit found the
  // old code's worst failure mode (movies duplicated and source orphaned on
  // partial failure); this pattern eliminates that class.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const currentOwnerId = auth.uid;

  const db = getDb();
  const BATCH_SIZE = 450; // Firestore batch limit is 500; leave headroom.

  try {
    const oldListRef = db
      .collection('users').doc(currentOwnerId)
      .collection('lists').doc(listId);
    const newListRef = db
      .collection('users').doc(newOwnerId)
      .collection('lists').doc(listId);

    // P1 — Atomic pre-flight: re-read the list under transaction semantics so
    // a concurrent ownership change can't sneak through between check and act.
    type PreflightOk = { kind: 'ok'; listData: FirebaseFirestore.DocumentData };
    type PreflightErr = { kind: 'err'; error: string };
    const preflight: PreflightOk | PreflightErr = await db.runTransaction(async (tx) => {
      const snap = await tx.get(oldListRef);
      if (!snap.exists) return { kind: 'err' as const, error: 'List not found.' };
      const data = snap.data() || {};
      if (data.ownerId !== currentOwnerId) {
        return { kind: 'err' as const, error: 'Only the list owner can transfer ownership.' };
      }
      const collaboratorIds: string[] = data.collaboratorIds || [];
      if (!collaboratorIds.includes(newOwnerId)) {
        return { kind: 'err' as const, error: 'New owner must be an existing collaborator.' };
      }
      return { kind: 'ok' as const, listData: data };
    });
    if (preflight.kind === 'err') return { error: preflight.error };

    const listData = preflight.listData;
    const collaboratorIds: string[] = listData.collaboratorIds || [];
    // The new owner moves out of the collaborators array; the previous owner
    // moves INTO it (becomes a collaborator on what was their own list).
    const newCollaborators = collaboratorIds
      .filter((id: string) => id !== newOwnerId)
      .concat([currentOwnerId]);

    // P2 — Copy movies to the new location. `set` is idempotent so re-runs of
    // a partially-completed transfer converge.
    const moviesSnapshot = await oldListRef.collection('movies').get();
    let copyBatch = db.batch();
    let copyOps = 0;
    for (const movieDoc of moviesSnapshot.docs) {
      copyBatch.set(newListRef.collection('movies').doc(movieDoc.id), movieDoc.data());
      copyOps++;
      if (copyOps >= BATCH_SIZE) {
        await copyBatch.commit();
        copyBatch = db.batch();
        copyOps = 0;
      }
    }
    if (copyOps > 0) await copyBatch.commit();

    // P3 — Create the list doc at the new owner's path. After this, both
    // paths technically exist; readers using the new path now see a valid
    // list. Old path is still canonical until P6.
    await newListRef.set({
      ...listData,
      ownerId: newOwnerId,
      collaboratorIds: newCollaborators,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // P4 — Re-point invites. The audit explicitly called this out: without
    // this, `getCollaborativeLists` reads `users/{oldOwner}/lists/{listId}`
    // for every invite-derived membership and finds nothing, silently breaking
    // every collaborator. Idempotent: only invites still pointing at the old
    // owner are updated; re-running is a no-op.
    const invitesSnapshot = await db.collection('invites')
      .where('listId', '==', listId)
      .where('listOwnerId', '==', currentOwnerId)
      .get();
    if (!invitesSnapshot.empty) {
      let inviteBatch = db.batch();
      let inviteOps = 0;
      for (const inv of invitesSnapshot.docs) {
        inviteBatch.update(inv.ref, { listOwnerId: newOwnerId });
        inviteOps++;
        if (inviteOps >= BATCH_SIZE) {
          await inviteBatch.commit();
          inviteBatch = db.batch();
          inviteOps = 0;
        }
      }
      if (inviteOps > 0) await inviteBatch.commit();
    }

    // P5 — Delete old movies in batches.
    let delBatch = db.batch();
    let delOps = 0;
    for (const movieDoc of moviesSnapshot.docs) {
      delBatch.delete(movieDoc.ref);
      delOps++;
      if (delOps >= BATCH_SIZE) {
        await delBatch.commit();
        delBatch = db.batch();
        delOps = 0;
      }
    }
    if (delOps > 0) await delBatch.commit();

    // P6 — The atomic "transferred" transition point: only after this does
    // the new location become canonical. A double-call after success will
    // hit P1 and return "List not found" — a graceful idempotent no-op.
    await oldListRef.delete();

    revalidatePath('/lists');
    revalidatePath(`/lists/${listId}`);
    return { success: true, newOwnerId };
  } catch (error) {
    console.error('[transferOwnership] Failed:', error);
    return { error: 'Failed to transfer ownership.' };
  }
}

/**
 * Get all lists owned by a user.
 */
export async function getUserLists(userId: string) {
  const db = getDb();

  try {
    const listsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('lists')
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
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    return { lists };
  } catch (error) {
    console.error('[getUserLists] Failed:', error);
    return { error: 'Failed to get user lists.', lists: [] };
  }
}

/**
 * Get lists where user is a collaborator (not owner).
 */
export async function getCollaborativeLists(userId: string) {
  const db = getDb();

  try {
    // Query the invites collection for accepted invites
    const acceptedInvites = await db.collection('invites')
      .where('inviteeId', '==', userId)
      .where('status', '==', 'accepted')
      .get();

    // Fetch all lists in PARALLEL (not sequentially)
    const listPromises = acceptedInvites.docs.map(async (inviteDoc) => {
      const inviteData = inviteDoc.data();
      const listDoc = await db
        .collection('users')
        .doc(inviteData.listOwnerId)
        .collection('lists')
        .doc(inviteData.listId)
        .get();

      if (listDoc.exists) {
        const listData = listDoc.data();
        // Verify user is still a collaborator
        if (listData?.collaboratorIds?.includes(userId)) {
          return {
            id: listDoc.id,
            name: listData.name,
            ownerId: inviteData.listOwnerId,
            ownerUsername: inviteData.inviterUsername,
            ownerDisplayName: inviteData.inviterDisplayName || inviteData.inviterUsername,
            isPublic: listData.isPublic,
            isDefault: listData.isDefault || false,
            collaboratorIds: listData.collaboratorIds || [],
            coverImageUrl: listData.coverImageUrl || null,
            createdAt: listData.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            updatedAt: listData.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          };
        }
      }
      return null;
    });

    const results = await Promise.all(listPromises);
    const lists = results.filter((list): list is NonNullable<typeof list> => list !== null);

    return { lists };
  } catch (error) {
    console.error('[getCollaborativeLists] Failed:', error);
    return { error: 'Failed to get collaborative lists.', lists: [] };
  }
}

/**
 * Upload an avatar image to Cloudflare R2.
 * Receives base64 image data and returns the download URL.
 * Uses a consistent filename per user to overwrite previous uploads.
 *
 * Required environment variables:
 * - R2_ACCESS_KEY_ID: R2 access key
 * - R2_SECRET_ACCESS_KEY: R2 secret key
 * - R2_ENDPOINT: R2 endpoint (e.g., https://<account_id>.r2.cloudflarestorage.com)
 * - R2_BUCKET_NAME: R2 bucket name
 * - R2_PUBLIC_BASE_URL: Public URL for the bucket (e.g., https://pub-xxx.r2.dev)
 */
export async function uploadAvatar(
  idToken: string,
  base64Data: string,
  fileName: string,
  mimeType: string
): Promise<{ url?: string; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  try {
    // Validate inputs
    if (!userId || !base64Data) {
      return { error: 'Missing required fields.' };
    }

    // Validate mime type - accept any image type (iOS sends various formats)
    if (!mimeType.startsWith('image/')) {
      return { error: `Invalid file type: ${mimeType}. Please upload an image file.` };
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate file size (max 5MB for avatars - phone photos can be large)
    const maxSize = 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      return { error: `File too large (${sizeMB}MB). Maximum size is 5MB.` };
    }

    // Check R2 configuration
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

    if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName || !publicBaseUrl) {
      console.error('[uploadAvatar] R2 not configured');
      return { error: 'Image upload is not configured. Please contact support.' };
    }

    // Import S3 client
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    // Create S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get file extension from mime type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'image/avif': 'avif',
      'image/tiff': 'tiff',
      'image/bmp': 'bmp',
    };
    // Extract extension from mime type or default to jpg
    const ext = extMap[mimeType] || mimeType.split('/')[1] || 'jpg';

    // Use consistent filename per user (overwrites previous avatar)
    const fileKey = `avatars/${userId}/avatar.${ext}`;

    // Upload to R2
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000',
      })
    );

    // Return the public URL with cache-busting timestamp
    const imageUrl = `${publicBaseUrl}/${fileKey}?v=${Date.now()}`;

    return { url: imageUrl };
  } catch (error) {
    console.error('[uploadAvatar] Failed:', error);
    return { error: 'Failed to upload image. Please try again.' };
  }
}

/**
 * Update user's profile photo URL.
 */
export async function updateProfilePhoto(idToken: string, photoURL: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Validate URL format
    if (!photoURL.startsWith('http://') && !photoURL.startsWith('https://')) {
      return { error: 'Invalid photo URL.' };
    }

    await db.collection('users').doc(userId).update({
      photoURL: photoURL,
    });

    revalidatePath('/profile');
    revalidatePath(`/profile/[username]`);
    return { success: true, photoURL };
  } catch (error) {
    console.error('[updateProfilePhoto] Failed:', error);
    return { error: 'Failed to update profile photo.' };
  }
}

/**
 * Update user's bio.
 */
export async function updateBio(idToken: string, bio: string) {
  // AUDIT.md Phase 1: caller identity comes from the verified token, never a
  // client-supplied userId. Writing to auth.uid makes the old IDOR (editing
  // another user's bio) structurally impossible.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;

  const db = getDb();

  try {
    // Limit bio length
    const trimmedBio = bio.trim().slice(0, 160);

    await db.collection('users').doc(auth.uid).update({
      bio: trimmedBio || null,
    });

    revalidatePath('/profile');
    revalidatePath(`/profile/[username]`);
    return { success: true, bio: trimmedBio };
  } catch (error) {
    console.error('[updateBio] Failed:', error);
    return { error: 'Failed to update bio.' };
  }
}

/**
 * Update user's favorite movies (top 5).
 */
export async function updateFavoriteMovies(
  idToken: string,
  favoriteMovies: Array<{ id: string; title: string; posterUrl: string; tmdbId: number }>
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Limit to 5 movies
    const limitedMovies = favoriteMovies.slice(0, 5);

    await db.collection('users').doc(userId).update({
      favoriteMovies: limitedMovies,
    });

    revalidatePath('/profile');
    revalidatePath(`/profile/[username]`);
    return { success: true, favoriteMovies: limitedMovies };
  } catch (error) {
    console.error('[updateFavoriteMovies] Failed:', error);
    return { error: 'Failed to update favorite movies.' };
  }
}

/**
 * Get preview posters and movie count for a list.
 */
export async function getListPreview(listOwnerId: string, listId: string, viewerIdToken?: string) {
  // AUDIT.md 1.13: previously NO privacy gate — anyone with ownerId+listId
  // could fetch poster previews + count from a PRIVATE list. Now: public lists
  // are open; private lists require a verified owner/collaborator token,
  // otherwise an empty preview is returned (no leak, no error).
  const db = getDb();

  try {
    const listSnap = await db
      .collection('users').doc(listOwnerId).collection('lists').doc(listId).get();
    if (!listSnap.exists) {
      return { previewPosters: [], movieCount: 0 };
    }
    const listInfo = listSnap.data();
    if (listInfo?.isPublic !== true) {
      // Private: only the owner or a collaborator (by verified token) may see it.
      const viewer = await verifyCaller(viewerIdToken);
      const viewerUid = isAuthError(viewer) ? null : viewer.uid;
      const collaboratorIds: string[] = listInfo?.collaboratorIds || [];
      const allowed =
        viewerUid != null &&
        (viewerUid === listOwnerId || collaboratorIds.includes(viewerUid));
      if (!allowed) {
        return { previewPosters: [], movieCount: 0 };
      }
    }

    // Get the first 4 movies from the list for preview posters
    const moviesSnapshot = await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .orderBy('createdAt', 'desc')
      .limit(4)
      .get();

    const previewPosters: string[] = [];
    moviesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.posterUrl) {
        previewPosters.push(data.posterUrl);
      }
    });

    // Get total movie count
    const allMoviesSnapshot = await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .count()
      .get();

    const movieCount = allMoviesSnapshot.data().count;

    return { previewPosters, movieCount };
  } catch (error) {
    console.error('[getListPreview] Failed:', error);
    return { previewPosters: [], movieCount: 0 };
  }
}

/**
 * Get preview posters for multiple lists at once (batch operation).
 */
export async function getListsPreviews(listOwnerId: string, listIds: string[], viewerIdToken?: string) {
  const db = getDb();
  const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};

  try {
    // Fetch previews for all lists in parallel (privacy enforced per-list in
    // getListPreview via the optional viewer token).
    const results = await Promise.all(
      listIds.map(async (listId) => {
        const result = await getListPreview(listOwnerId, listId, viewerIdToken);
        return { listId, ...result };
      })
    );

    results.forEach(({ listId, previewPosters, movieCount }) => {
      previews[listId] = { previewPosters, movieCount };
    });

    return { previews };
  } catch (error) {
    console.error('[getListsPreviews] Failed:', error);
    return { previews: {} };
  }
}

/**
 * Upload list cover image to R2. (AUDIT.md 1.5 sibling)
 * First param is the LIST OWNER — the R2 key and Firestore path live under the
 * owner, so a collaborator's uid differs from it. Verify the caller, then
 * require owner-or-collaborator edit rights on that list.
 */
export async function uploadListCover(
  idToken: string,
  listOwnerId: string,
  listId: string,
  base64Data: string,
  fileName: string,
  mimeType: string
): Promise<{ url?: string; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;

  try {
    // Validate inputs
    if (!listOwnerId || !listId || !base64Data) {
      return { error: 'Missing required fields.' };
    }

    const canEdit = await canEditList(auth.uid, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to update this list.' };
    }

    // Validate mime type - accept any image type (iOS sends various formats)
    if (!mimeType.startsWith('image/')) {
      return { error: `Invalid file type: ${mimeType}. Please upload an image file.` };
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate file size (max 10MB for covers - phone photos can be large)
    const maxSize = 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      return { error: `File too large (${sizeMB}MB). Maximum size is 10MB.` };
    }

    // Check R2 configuration
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

    if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName || !publicBaseUrl) {
      const missing = [];
      if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
      if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
      if (!endpoint) missing.push('R2_ENDPOINT');
      if (!bucketName) missing.push('R2_BUCKET_NAME');
      if (!publicBaseUrl) missing.push('R2_PUBLIC_BASE_URL');
      console.error('[uploadListCover] R2 not configured. Missing:', missing.join(', '));
      return { error: `Missing env vars: ${missing.join(', ')}` };
    }

    console.log('[uploadListCover] Starting upload for owner:', listOwnerId, 'list:', listId);

    // Import S3 client
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    // Create S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get file extension from mime type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'image/avif': 'avif',
      'image/tiff': 'tiff',
      'image/bmp': 'bmp',
    };
    // Extract extension from mime type or default to jpg
    const ext = extMap[mimeType] || mimeType.split('/')[1] || 'jpg';

    // Use consistent filename per list (overwrites previous cover)
    const fileKey = `covers/${listOwnerId}/${listId}/cover.${ext}`;

    // Upload to R2
    console.log('[uploadListCover] Uploading to R2:', fileKey);
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          Body: buffer,
          ContentType: mimeType,
          CacheControl: 'public, max-age=31536000',
        })
      );
    } catch (r2Error) {
      console.error('[uploadListCover] R2 upload failed:', r2Error);
      const msg = r2Error instanceof Error ? r2Error.message : 'Unknown R2 error';
      return { error: `R2 upload failed: ${msg}` };
    }

    // Return the public URL with cache-busting timestamp
    const imageUrl = `${publicBaseUrl}/${fileKey}?v=${Date.now()}`;
    console.log('[uploadListCover] R2 upload success, updating Firestore:', imageUrl);

    // Update the list document with the new cover URL
    const db = getDb();
    try {
      await db
        .collection('users')
        .doc(listOwnerId)
        .collection('lists')
        .doc(listId)
        .update({
          coverImageUrl: imageUrl,
          updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (firestoreError) {
      console.error('[uploadListCover] Firestore update failed:', firestoreError);
      const msg = firestoreError instanceof Error ? firestoreError.message : 'Unknown Firestore error';
      // Image uploaded but Firestore failed - still return the URL
      return { error: `Image uploaded but database update failed: ${msg}`, url: imageUrl };
    }

    console.log('[uploadListCover] Success!');
    revalidatePath('/lists');
    return { url: imageUrl };
  } catch (error) {
    console.error('[uploadListCover] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { error: `Unexpected error: ${errorMessage}` };
  }
}

/**
 * Update list cover image.
 */
export async function updateListCover(idToken: string, listOwnerId: string, listId: string, coverImageUrl: string | null) {
  // AUDIT.md 1.5: previously NO permission check — anyone could swap any list's
  // cover. First param is the list OWNER (path), not the caller. Verify the
  // caller, then require owner-or-collaborator edit rights on that list.
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;

  const db = getDb();

  try {
    const canEdit = await canEditList(auth.uid, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to update this list.' };
    }

    await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .update({
        coverImageUrl: coverImageUrl,
        updatedAt: FieldValue.serverTimestamp(),
      });

    revalidatePath('/lists');
    return { success: true };
  } catch (error) {
    console.error('[updateListCover] Failed:', error);
    return { error: 'Failed to update list cover.' };
  }
}

// --- REVIEWS ---

/**
 * Create a new review/comment for a movie/TV show.
 * Users can post multiple comments on the same movie (like Reddit/YouTube).
 * Optionally pass the user's rating to snapshot with the comment.
 */
export async function createReview(
  idToken: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  moviePosterUrl: string | undefined,
  text: string,
  ratingAtTime?: number | null, // Optional: pass the current user rating to snapshot
  parentId?: string | null // Optional: if replying to another review
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  // AUDIT.md 3.8: cap scripted review/comment spam (+ @mention notifications).
  const rl = await checkRateLimit(userId, 'review');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    // Get user profile for username and photo
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { error: 'User not found.' };
    }
    const userData = userDoc.data();

    // If no rating passed, try to fetch user's current rating
    let rating = ratingAtTime;
    if (rating === undefined) {
      const ratingId = `${userId}_${tmdbId}`;
      const ratingDoc = await db.collection('ratings').doc(ratingId).get();
      if (ratingDoc.exists) {
        rating = ratingDoc.data()?.rating || null;
      } else {
        rating = null;
      }
    }

    // Create the review (users can post multiple)
    const reviewRef = db.collection('reviews').doc();
    const reviewData = {
      id: reviewRef.id,
      tmdbId,
      mediaType,
      movieTitle,
      moviePosterUrl: moviePosterUrl || null,
      userId,
      username: userData?.username || null,
      userDisplayName: userData?.displayName || null,
      userPhotoUrl: userData?.photoURL || null,
      text: text.trim(),
      ratingAtTime: rating, // Snapshot of user's rating when this comment was posted
      likes: 0,
      likedBy: [],
      parentId: parentId || null, // Threading: null = top-level review
      replyCount: 0, // Threading: starts at 0, incremented when replies are added
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await reviewRef.set(reviewData);

    // If this is a reply, increment the parent's replyCount and notify parent author
    if (parentId) {
      const parentRef = db.collection('reviews').doc(parentId);
      const parentDoc = await parentRef.get();

      await parentRef.update({
        replyCount: FieldValue.increment(1),
      });

      // Create reply notification (must await in serverless - fire-and-forget gets killed)
      if (parentDoc.exists) {
        try {
          await createReplyNotification(
            db,
            reviewRef.id,
            text.trim(),
            { userId: parentDoc.data()?.userId },
            tmdbId,
            mediaType,
            movieTitle,
            userId,
            userData?.username || null,
            userData?.displayName || null,
            userData?.photoURL || null
          );
        } catch (err) {
          console.error('[createReview] Reply notification failed:', err);
        }
      }
    }

    // Create @mention notifications (must await in serverless - fire-and-forget gets killed)
    try {
      await createMentionNotifications(
        db,
        reviewRef.id,
        text.trim(),
        tmdbId,
        mediaType,
        movieTitle,
        userId,
        userData?.username || null,
        userData?.displayName || null,
        userData?.photoURL || null
      );
    } catch (err) {
      console.error('[createReview] Mention notifications failed:', err);
    }

    // Create 'reviewed' activity for top-level reviews only (not replies)
    if (!parentId) {
      try {
        await createActivity(db, {
          userId,
          type: 'reviewed',
          tmdbId,
          movieTitle,
          moviePosterUrl: moviePosterUrl || null,
          movieYear: '', // Not available in review context
          mediaType,
          reviewText: text.trim().substring(0, 200), // Preview text
          reviewId: reviewRef.id,
        });
      } catch (activityError) {
        console.error('[createReview] Failed to create activity:', activityError);
      }
    }

    return {
      success: true,
      review: {
        ...reviewData,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  } catch (error) {
    console.error('[createReview] Failed:', error);
    return { error: 'Failed to create review.' };
  }
}

/**
 * Get reviews for a movie/TV show.
 */
export async function getMovieReviews(
  tmdbId: number,
  sortBy: 'recent' | 'likes' = 'recent',
  limit: number = 50
) {
  const db = getDb();

  try {
    // Only fetch top-level reviews (not replies)
    let query = db.collection('reviews')
      .where('tmdbId', '==', tmdbId)
      .where('parentId', '==', null);

    if (sortBy === 'likes') {
      query = query.orderBy('likes', 'desc').orderBy('createdAt', 'desc');
    } else {
      query = query.orderBy('createdAt', 'desc');
    }

    const snapshot = await query.limit(limit).get();

    const reviews = snapshot.docs.map((doc) => {
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
        ratingAtTime: data.ratingAtTime ?? null, // Rating snapshot when comment was posted
        likes: data.likes || 0,
        likedBy: data.likedBy || [],
        parentId: data.parentId || null,
        replyCount: data.replyCount || 0,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    });

    return { reviews };
  } catch (error) {
    console.error('[getMovieReviews] Failed:', error);
    return { error: 'Failed to fetch reviews.', reviews: [] };
  }
}

/**
 * Get replies for a review.
 */
export async function getReviewReplies(parentId: string, limit: number = 50) {
  const db = getDb();

  try {
    const snapshot = await db.collection('reviews')
      .where('parentId', '==', parentId)
      .orderBy('createdAt', 'asc') // Oldest first for replies (chronological)
      .limit(limit)
      .get();

    const replies = snapshot.docs.map((doc) => {
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
        parentId: data.parentId,
        replyCount: 0, // Replies don't have replies (1-level threading)
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    });

    return { replies };
  } catch (error) {
    console.error('[getReviewReplies] Failed:', error);
    return { error: 'Failed to fetch replies.', replies: [] };
  }
}

/**
 * Like a review.
 */
export async function likeReview(idToken: string, reviewId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  // AUDIT.md 3.8: cap scripted like/notification spam.
  const rl = await checkRateLimit(userId, 'like');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);

    // AUDIT.md 3.5: read-check-write in one transaction. The old separate
    // get()-then-update() let a fast double-tap run increment(1) twice while
    // arrayUnion deduped likedBy to a single entry → likes count drifted.
    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(reviewRef);
      if (!snap.exists) return { error: 'Review not found.' as const };
      const data = snap.data() || {};
      const likedBy: string[] = data.likedBy || [];
      if (likedBy.includes(userId)) return { error: 'Already liked.' as const };
      tx.update(reviewRef, {
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(userId),
      });
      return { ok: true as const, reviewData: data, newLikes: (data.likes || 0) + 1 };
    });
    // txResult.error is `string` at runtime in this branch; the `| undefined`
    // is only a TS union-normalization artifact (the ok-variant never carries
    // `error`). The cast keeps the function's return type clean.
    if ('error' in txResult) return { error: txResult.error as string };
    const reviewData = txResult.reviewData;

    // Create like notification (don't notify yourself) — post-commit, best-effort.
    if (reviewData?.userId && reviewData.userId !== userId) {
      try {
        // Check if review author has likes notifications enabled
        const authorDoc = await db.collection('users').doc(reviewData.userId).get();
        const authorData = authorDoc.data();
        const prefs = authorData?.notificationPreferences;

        // Only create notification if likes are enabled (default true)
        if (!prefs || prefs.likes !== false) {
          const likerDoc = await db.collection('users').doc(userId).get();
          const likerData = likerDoc.data();

          await db.collection('notifications').add({
            userId: reviewData.userId, // Review author
            type: 'like',
            fromUserId: userId,
            fromUsername: likerData?.username || null,
            fromDisplayName: likerData?.displayName || null,
            fromPhotoUrl: likerData?.photoURL || null,
            reviewId,
            tmdbId: reviewData.tmdbId,
            mediaType: reviewData.mediaType,
            movieTitle: reviewData.movieTitle,
            previewText: reviewData.text?.slice(0, 100) + (reviewData.text?.length > 100 ? '...' : ''),
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('[likeReview] Failed to create notification:', err);
      }
    }

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[likeReview] Failed:', error);
    return { error: 'Failed to like review.' };
  }
}

/**
 * Unlike a review.
 */
export async function unlikeReview(idToken: string, reviewId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);

    // AUDIT.md 3.5: atomic read-check-write (see likeReview).
    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(reviewRef);
      if (!snap.exists) return { error: 'Review not found.' as const };
      const data = snap.data() || {};
      const likedBy: string[] = data.likedBy || [];
      if (!likedBy.includes(userId)) return { error: 'Not liked yet.' as const };
      tx.update(reviewRef, {
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(userId),
      });
      return { ok: true as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
    });
    // txResult.error is `string` at runtime in this branch; the `| undefined`
    // is only a TS union-normalization artifact (the ok-variant never carries
    // `error`). The cast keeps the function's return type clean.
    if ('error' in txResult) return { error: txResult.error as string };

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[unlikeReview] Failed:', error);
    return { error: 'Failed to unlike review.' };
  }
}

/**
 * Like a public list (LAUNCH 0.5.1).
 *
 * Mirrors `likeReview`: verifyCaller → rate-limit → transactional
 * read-check-write. Only public lists are likeable. `likes`/`likedBy`/
 * `lastLikedAt` are server-only — `firestore.rules` blocks the owner from
 * editing them so counts can't be forged.
 */
export async function likeList(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  // Reuse the shared `like` rate-limit bucket (AUDIT.md 3.8).
  const rl = await checkRateLimit(userId, 'like');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);

    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(listRef);
      if (!snap.exists) return { error: 'List not found.' as const };
      const data = snap.data() || {};
      if (data.isPublic !== true) return { error: 'Only public lists can be liked.' as const };
      const likedBy: string[] = data.likedBy || [];
      if (likedBy.includes(userId)) return { error: 'Already liked.' as const };
      tx.update(listRef, {
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(userId),
        lastLikedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true as const, listData: data, newLikes: (data.likes || 0) + 1 };
    });
    if ('error' in txResult) return { error: txResult.error as string };

    // Notify the owner — post-commit, best-effort, never self.
    if (listOwnerId && listOwnerId !== userId) {
      try {
        const ownerDoc = await db.collection('users').doc(listOwnerId).get();
        const prefs = ownerDoc.data()?.notificationPreferences;
        if (!prefs || prefs.likes !== false) {
          const likerDoc = await db.collection('users').doc(userId).get();
          const likerData = likerDoc.data();
          await db.collection('notifications').add({
            userId: listOwnerId,
            type: 'list_like',
            fromUserId: userId,
            fromUsername: likerData?.username || null,
            fromDisplayName: likerData?.displayName || null,
            fromPhotoUrl: likerData?.photoURL || null,
            listId,
            listOwnerId,
            listName: txResult.listData?.name || 'your list',
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('[likeList] Failed to create notification:', err);
      }
    }

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[likeList] Failed:', error);
    return { error: 'Failed to like list.' };
  }
}

/**
 * Unlike a public list (LAUNCH 0.5.1). `lastLikedAt` is intentionally left
 * untouched — unliking is not "activity" that should refresh recency.
 */
export async function unlikeList(idToken: string, listOwnerId: string, listId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const listRef = db.collection('users').doc(listOwnerId).collection('lists').doc(listId);

    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(listRef);
      if (!snap.exists) return { error: 'List not found.' as const };
      const data = snap.data() || {};
      const likedBy: string[] = data.likedBy || [];
      if (!likedBy.includes(userId)) return { error: 'Not liked yet.' as const };
      tx.update(listRef, {
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(userId),
      });
      return { ok: true as const, newLikes: Math.max(0, (data.likes || 1) - 1) };
    });
    if ('error' in txResult) return { error: txResult.error as string };

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[unlikeList] Failed:', error);
    return { error: 'Failed to unlike list.' };
  }
}

/**
 * Delete a review (only by owner).
 */
export async function deleteReview(idToken: string, reviewId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return { error: 'Review not found.' };
    }

    const reviewData = reviewDoc.data();
    if (reviewData?.userId !== userId) {
      return { error: 'You can only delete your own reviews.' };
    }

    await reviewRef.delete();

    return { success: true };
  } catch (error) {
    console.error('[deleteReview] Failed:', error);
    return { error: 'Failed to delete review.' };
  }
}

/**
 * Update a review (only by owner).
 */
export async function updateReview(idToken: string, reviewId: string, text: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return { error: 'Review not found.' };
    }

    const reviewData = reviewDoc.data();
    if (reviewData?.userId !== userId) {
      return { error: 'You can only edit your own reviews.' };
    }

    await reviewRef.update({
      text: text.trim(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('[updateReview] Failed:', error);
    return { error: 'Failed to update review.' };
  }
}

/**
 * Get a user's review for a specific movie.
 */
export async function getUserReviewForMovie(userId: string, tmdbId: number) {
  const db = getDb();

  try {
    const snapshot = await db
      .collection('reviews')
      .where('userId', '==', userId)
      .where('tmdbId', '==', tmdbId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { review: null };
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    return {
      review: {
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
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      },
    };
  } catch (error) {
    console.error('[getUserReviewForMovie] Failed:', error);
    return { error: 'Failed to fetch review.', review: null };
  }
}

// --- USER RATINGS ---

/**
 * Create or update a user's rating for a movie/TV show.
 * Rating is 1.0-10.0 with one decimal place.
 */
export async function createOrUpdateRating(
  idToken: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  moviePosterUrl: string | undefined,
  rating: number
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Validate rating range (1.0 - 10.0)
    if (rating < 1 || rating > 10) {
      return { error: 'Rating must be between 1.0 and 10.0.' };
    }

    // Round to one decimal place
    const roundedRating = Math.round(rating * 10) / 10;

    // Use deterministic document ID: `${userId}_${tmdbId}`
    const ratingId = `${userId}_${tmdbId}`;
    const ratingRef = db.collection('ratings').doc(ratingId);
    const existingDoc = await ratingRef.get();

    const ratingData = {
      id: ratingId,
      userId,
      tmdbId,
      mediaType,
      movieTitle,
      moviePosterUrl: moviePosterUrl || null,
      rating: roundedRating,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const isNewRating = !existingDoc.exists;

    if (existingDoc.exists) {
      // Update existing rating
      await ratingRef.update(ratingData);
    } else {
      // Create new rating
      await ratingRef.set({
        ...ratingData,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Create activity for new ratings
    if (isNewRating) {
      try {
        await createActivity(db, {
          userId,
          type: 'rated',
          tmdbId,
          movieTitle,
          moviePosterUrl: moviePosterUrl || null,
          movieYear: '', // Year not available in rating context
          mediaType,
          rating: roundedRating,
        });
      } catch (activityError) {
        console.error('[createOrUpdateRating] Failed to create activity:', activityError);
      }
    }

    return {
      success: true,
      rating: {
        ...ratingData,
        createdAt: existingDoc.exists
          ? existingDoc.data()?.createdAt?.toDate() || new Date()
          : new Date(),
        updatedAt: new Date(),
      },
    };
  } catch (error) {
    console.error('[createOrUpdateRating] Failed:', error);
    return { error: 'Failed to save rating.' };
  }
}

/**
 * Get a user's rating for a specific movie/TV show.
 */
export async function getUserRating(userId: string, tmdbId: number) {
  const db = getDb();

  try {
    const ratingId = `${userId}_${tmdbId}`;
    const ratingDoc = await db.collection('ratings').doc(ratingId).get();

    if (!ratingDoc.exists) {
      return { rating: null };
    }

    const data = ratingDoc.data();
    return {
      rating: {
        id: ratingDoc.id,
        userId: data?.userId,
        tmdbId: data?.tmdbId,
        mediaType: data?.mediaType,
        movieTitle: data?.movieTitle,
        moviePosterUrl: data?.moviePosterUrl,
        rating: data?.rating,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      },
    };
  } catch (error) {
    console.error('[getUserRating] Failed:', error);
    return { error: 'Failed to fetch rating.', rating: null };
  }
}

/**
 * Delete a user's rating for a movie/TV show.
 */
export async function deleteRating(idToken: string, tmdbId: number) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const ratingId = `${userId}_${tmdbId}`;
    const ratingRef = db.collection('ratings').doc(ratingId);
    const ratingDoc = await ratingRef.get();

    if (!ratingDoc.exists) {
      return { error: 'Rating not found.' };
    }

    const data = ratingDoc.data();
    if (data?.userId !== userId) {
      return { error: 'You can only delete your own ratings.' };
    }

    await ratingRef.delete();

    return { success: true };
  } catch (error) {
    console.error('[deleteRating] Failed:', error);
    return { error: 'Failed to delete rating.' };
  }
}

/**
 * Get all ratings for a user (for profile/stats).
 */
export async function getUserRatings(
  userId: string,
  limit: number = 100,
  cursor?: string, // ISO timestamp of the last seen rating's updatedAt
) {
  // AUDIT.md 2.5: cursor support added so callers can paginate past the
  // single-call cap (the ratings cache previously stopped at 500 — Letterboxd
  // importers with 1000+ ratings silently lost the tail). Pass the last
  // result's `updatedAt` to fetch the next page; results are ordered by
  // updatedAt desc, so the cursor is monotonic.
  const db = getDb();

  try {
    let q = db
      .collection('ratings')
      .where('userId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .limit(limit);
    if (cursor) {
      q = q.startAfter(new Date(cursor));
    }
    const snapshot = await q.get();

    const ratings = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        tmdbId: data.tmdbId,
        mediaType: data.mediaType,
        movieTitle: data.movieTitle,
        moviePosterUrl: data.moviePosterUrl,
        rating: data.rating,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    });

    return { ratings };
  } catch (error) {
    console.error('[getUserRatings] Failed:', error);
    return { error: 'Failed to fetch ratings.', ratings: [] };
  }
}

// --- BACKFILL: Denormalize user data for existing movies ---

/**
 * One-time backfill to populate denormalized user data on existing movies.
 * This adds addedByDisplayName, addedByUsername, addedByPhotoURL, and noteAuthors
 * to movies that were created before the denormalization feature was added.
 *
 * Run this once via an admin page or API route.
 */
// ============================================
// ONBOARDING ACTIONS
// ============================================

/**
 * Check if a username is available.
 * Uses Firestore for now - can be migrated to RTDB for faster lookups later.
 */
export async function checkUsernameAvailability(username: string) {
  const db = getDb();

  try {
    const normalized = username.toLowerCase().trim();

    // Validate format
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      return { available: false, error: 'Invalid username format' };
    }

    // Check if username exists
    const snapshot = await db
      .collection('users')
      .where('usernameLower', '==', normalized)
      .limit(1)
      .get();

    const isAvailable = snapshot.empty;

    // Generate suggestions if taken
    let suggestions: string[] = [];
    if (!isAvailable) {
      suggestions = [
        `${normalized}${Math.floor(Math.random() * 100)}`,
        `${normalized}_films`,
        `${normalized}${new Date().getFullYear() % 100}`,
      ];
    }

    return { available: isAvailable, suggestions };
  } catch (error) {
    console.error('[checkUsernameAvailability] Failed:', error);
    return { available: false, error: 'Failed to check username' };
  }
}

/**
 * Create user profile with a chosen username (during onboarding).
 * This is called after the user picks their username.
 */
export async function createUserProfileWithUsername(
  idToken: string,
  email: string,
  username: string,
  displayName: string | null
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const normalized = username.toLowerCase().trim();

    // Validate format
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      return { error: 'Invalid username format' };
    }

    // Double-check availability (race condition protection)
    const existingSnapshot = await db
      .collection('users')
      .where('usernameLower', '==', normalized)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      return { error: 'Username is already taken' };
    }

    // Check if user already has a profile
    const userRef = db.collection('users').doc(userId);
    const existingUser = await userRef.get();

    if (existingUser.exists) {
      // Update existing profile with username
      await userRef.update({
        username: normalized,
        usernameLower: normalized,
        displayName: displayName,
        displayNameLower: displayName?.toLowerCase() || null,
        onboardingComplete: false, // Will be set to true after import/friends steps
      });
    } else {
      // Create new profile. AUDIT.md 1.9: email goes to /users_private, never
      // the publicly-readable /users doc.
      await userRef.set({
        uid: userId,
        displayName: displayName,
        displayNameLower: displayName?.toLowerCase() || null,
        photoURL: null,
        username: normalized,
        usernameLower: normalized,
        followersCount: 0,
        followingCount: 0,
        onboardingComplete: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.collection('users_private').doc(userId).set({
        uid: userId,
        email: email,
        emailLower: email.toLowerCase(),
      });
    }

    // Create default list
    const listsSnapshot = await userRef.collection('lists').limit(1).get();
    let defaultListId: string | null = null;

    if (listsSnapshot.empty) {
      const listRef = userRef.collection('lists').doc();
      await listRef.set({
        id: listRef.id,
        name: 'My Watchlist',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        isDefault: true,
        isPublic: false,
        ownerId: userId,
        collaboratorIds: [],
        movieCount: 0,
      });
      defaultListId = listRef.id;
    } else {
      defaultListId = listsSnapshot.docs[0].id;
    }

    return { success: true, defaultListId };
  } catch (error) {
    console.error('[createUserProfileWithUsername] Failed:', error);
    return { error: 'Failed to create profile' };
  }
}

/**
 * Parse pasted movie list text and match with TMDB.
 */
export async function parseAndMatchMovies(text: string) {
  try {
    const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
    if (!TMDB_ACCESS_TOKEN) {
      return { error: 'TMDB not configured' };
    }

    // Parse the text into movie entries
    const lines = text
      .split(/\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const parsed: Array<{ originalLine: string; title: string; year: number | null }> = [];

    for (const line of lines) {
      // Remove common prefixes: "1. ", "- ", "• ", "* ", "1) "
      let cleaned = line
        .replace(/^[\d]+[.\)]\s*/, '')
        .replace(/^[-•*]\s*/, '')
        .trim();

      // Extract year: "Movie (2010)" or "Movie [2010]" or "Movie 2010"
      const yearMatch = cleaned.match(/[\(\[]?(\d{4})[\)\]]?\s*$/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      // Remove year from title
      const title = cleaned
        .replace(/[\(\[]?\d{4}[\)\]]?\s*$/, '')
        .trim();

      if (title.length > 0) {
        parsed.push({ originalLine: line, title, year });
      }
    }

    if (parsed.length === 0) {
      return { error: 'No movies found in text' };
    }

    // Match with TMDB (process in batches to avoid rate limiting)
    const matches: Array<{
      parsed: { originalLine: string; title: string; year: number | null };
      match: any | null;
      status: 'exact_match' | 'best_guess' | 'not_found';
      selected: boolean;
    }> = [];

    for (const item of parsed) {
      try {
        const query = encodeURIComponent(item.title);
        const yearParam = item.year ? `&year=${item.year}` : '';
        const url = `https://api.themoviedb.org/3/search/movie?query=${query}${yearParam}&language=en-US&page=1`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
          continue;
        }

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) {
          matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
          continue;
        }

        // Find exact year match if year was provided
        let bestMatch = results[0];
        let status: 'exact_match' | 'best_guess' = 'best_guess';

        if (item.year) {
          const exactMatch = results.find((r: any) =>
            r.release_date?.startsWith(item.year!.toString())
          );
          if (exactMatch) {
            bestMatch = exactMatch;
            status = 'exact_match';
          }
        } else if (results[0].release_date) {
          status = 'exact_match'; // Trust first result without year filter
        }

        matches.push({ parsed: item, match: bestMatch, status, selected: true });
      } catch (err) {
        matches.push({ parsed: item, match: null, status: 'not_found', selected: false });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return { matches };
  } catch (error) {
    console.error('[parseAndMatchMovies] Failed:', error);
    return { error: 'Failed to parse movies' };
  }
}

/**
 * Import matched movies to user's default list.
 */
export async function importMatchedMovies(
  userId: string,
  matchedMovies: Array<{
    parsed: { originalLine: string; title: string; year: number | null };
    match: any | null;
    status: string;
    selected: boolean;
  }>
) {
  const db = getDb();

  try {
    // Get user's default list
    const listsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .where('isDefault', '==', true)
      .limit(1)
      .get();

    let listId: string;
    if (listsSnapshot.empty) {
      // Create default list if doesn't exist
      const listRef = db.collection('users').doc(userId).collection('lists').doc();
      await listRef.set({
        id: listRef.id,
        name: 'My Watchlist',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        isDefault: true,
        isPublic: false,
        ownerId: userId,
        collaboratorIds: [],
        movieCount: 0,
      });
      listId = listRef.id;
    } else {
      listId = listsSnapshot.docs[0].id;
    }

    // Get user data for denormalization
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Filter to selected movies with matches
    const moviesToImport = matchedMovies.filter(m => m.selected && m.match);
    let importedCount = 0;

    // Import in batches of 500 (Firestore limit)
    const batches: FirebaseFirestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationCount = 0;

    for (const { match } of moviesToImport) {
      const docId = `movie_${match.id}`;
      const movieRef = db
        .collection('users')
        .doc(userId)
        .collection('lists')
        .doc(listId)
        .collection('movies')
        .doc(docId);

      currentBatch.set(movieRef, {
        id: docId,
        title: match.title,
        year: match.release_date?.slice(0, 4) || '',
        posterUrl: match.poster_path
          ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
          : null,
        posterHint: match.title,
        addedBy: userId,
        status: 'To Watch',
        createdAt: FieldValue.serverTimestamp(),
        mediaType: 'movie',
        tmdbId: match.id,
        overview: match.overview || null,
        rating: match.vote_average || null,
        backdropUrl: match.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
          : null,
        addedByDisplayName: userData?.displayName || null,
        addedByUsername: userData?.username || null,
        addedByPhotoURL: userData?.photoURL || null,
      }, { merge: true });

      operationCount++;
      importedCount++;

      if (operationCount >= 500) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      }
    }

    if (operationCount > 0) {
      batches.push(currentBatch);
    }

    // Commit all batches
    for (const batch of batches) {
      await batch.commit();
    }

    // AUDIT.md 2.2: bulk imports can't be one transaction (500-op limit), so
    // instead of `increment(importedCount)` — which over-counts on re-import /
    // overlapping movies and drifts on partial failure — recount the
    // subcollection and SET the authoritative value. Idempotent + self-healing:
    // re-running an import converges movieCount to reality.
    const importedListRef = db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .doc(listId);
    const importedCountSnap = await importedListRef.collection('movies').count().get();
    await importedListRef.update({
      movieCount: importedCountSnap.data().count,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, importedCount };
  } catch (error) {
    console.error('[importMatchedMovies] Failed:', error);
    return { error: 'Failed to import movies' };
  }
}

/**
 * Parse Letterboxd export ZIP or CSV file.
 */
export async function parseLetterboxdExport(base64Data: string, fileName: string) {
  try {
    // Dynamic import for jszip and papaparse
    const JSZip = (await import('jszip')).default;
    const Papa = (await import('papaparse')).default;

    const buffer = Buffer.from(base64Data, 'base64');

    type LetterboxdRow = {
      Date?: string;
      Name: string;
      Year: string;
      'Letterboxd URI'?: string;
      Rating?: string;
    };

    type LetterboxdReviewRow = {
      Date?: string;
      Name: string;
      Year: string;
      'Letterboxd URI'?: string;
      Rating?: string;
      Review?: string;
    };

    const parseCSV = <T>(text: string): T[] => {
      const result = Papa.parse<T>(text, { header: true });
      return result.data.filter((row: any) => row.Name && row.Name.trim());
    };

    type LetterboxdListData = {
      name: string;
      description?: string;
      movies: LetterboxdRow[];
    };

    let data: {
      watched: LetterboxdRow[];
      ratings: LetterboxdRow[];
      watchlist: LetterboxdRow[];
      reviews: LetterboxdReviewRow[];
      favorites: LetterboxdRow[]; // From profile favorites (4 movies)
      lists: LetterboxdListData[]; // User's custom lists
    } = {
      watched: [],
      ratings: [],
      watchlist: [],
      reviews: [],
      favorites: [],
      lists: [],
    };

    if (fileName.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(buffer);

      // Try to find CSV files in the ZIP
      const watchedFile = zip.file('watched.csv');
      const ratingsFile = zip.file('ratings.csv');
      const watchlistFile = zip.file('watchlist.csv');
      const reviewsFile = zip.file('reviews.csv');

      if (watchedFile) {
        const text = await watchedFile.async('text');
        data.watched = parseCSV<LetterboxdRow>(text);
      }

      if (ratingsFile) {
        const text = await ratingsFile.async('text');
        data.ratings = parseCSV<LetterboxdRow>(text);
      }

      if (watchlistFile) {
        const text = await watchlistFile.async('text');
        data.watchlist = parseCSV<LetterboxdRow>(text);
      }

      if (reviewsFile) {
        const text = await reviewsFile.async('text');
        data.reviews = parseCSV<LetterboxdReviewRow>(text);
      }

      // Parse profile.csv to get favorite films (stored as Letterboxd URIs)
      const profileFile = zip.file('profile.csv');
      if (profileFile) {
        const text = await profileFile.async('text');
        type ProfileRow = {
          'Date Joined'?: string;
          Username?: string;
          Bio?: string;
          'Favorite Films'?: string;
        };
        const profileData = parseCSV<ProfileRow>(text);
        if (profileData.length > 0 && profileData[0]['Favorite Films']) {
          // Favorite Films is comma-separated Letterboxd URIs like "https://boxd.it/eDGs, https://boxd.it/4VZ8"
          const favoriteUris = profileData[0]['Favorite Films']
            .split(',')
            .map(uri => uri.trim())
            .filter(uri => uri.length > 0);

          // Build a lookup map from watched.csv to match URIs to movie names
          const uriToMovie = new Map<string, LetterboxdRow>();
          for (const movie of data.watched) {
            if (movie['Letterboxd URI']) {
              uriToMovie.set(movie['Letterboxd URI'], movie);
            }
          }
          // Also check ratings if not in watched
          for (const movie of data.ratings) {
            if (movie['Letterboxd URI'] && !uriToMovie.has(movie['Letterboxd URI'])) {
              uriToMovie.set(movie['Letterboxd URI'], movie);
            }
          }

          // Match favorite URIs to movies
          for (const uri of favoriteUris) {
            const movie = uriToMovie.get(uri);
            if (movie && data.favorites.length < 5) {
              data.favorites.push(movie);
            }
          }
        }
      }

      // Look for lists in the lists/ folder
      // Letterboxd exports user lists as lists/*.csv
      const listFiles = Object.keys(zip.files).filter(name =>
        name.startsWith('lists/') && name.endsWith('.csv')
      );

      for (const listPath of listFiles) {
        const listFile = zip.file(listPath);
        if (listFile) {
          const text = await listFile.async('text');
          const lines = text.split('\n');

          // Letterboxd list CSV format (v7):
          // Line 1: "Letterboxd list export v7"
          // Line 2: "Date,Name,Tags,URL,Description" (list metadata header)
          // Line 3: List metadata with name and description
          // Line 4: empty
          // Line 5: "Position,Name,Year,URL,Description" (movie data header)
          // Line 6+: Movie entries

          let listName = listPath.replace('lists/', '').replace('.csv', '');
          let description = '';
          let movieStartIndex = 0;

          // Find the list metadata section and movie section
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Found list metadata header - next line has list info
            if (line.startsWith('Date,Name,Tags,') || line === 'Date,Name,Tags,URL,Description') {
              // Parse the next line as list metadata
              if (i + 1 < lines.length) {
                const metadataLine = lines[i + 1];
                // Parse this CSV line to extract Name and Description
                // Format: Date,Name,Tags,URL,Description
                const metaResult = Papa.parse<{ Name?: string; Description?: string }>(
                  line + '\n' + metadataLine,
                  { header: true }
                );
                if (metaResult.data.length > 0) {
                  const meta = metaResult.data[0];
                  if (meta.Name) listName = meta.Name.trim();
                  if (meta.Description) description = meta.Description.trim();
                }
              }
            }

            // Found movie data header - movies start from next line
            if (line.startsWith('Position,Name,Year,') || line.startsWith('Position,Name,Year')) {
              movieStartIndex = i;
              break;
            }
          }

          // Parse the movies section
          const moviesCsvText = lines.slice(movieStartIndex).join('\n');
          const parsed = parseCSV<LetterboxdRow>(moviesCsvText);

          // Add list with movies
          if (parsed.length > 0) {
            data.lists.push({
              name: listName,
              description: description || undefined,
              movies: parsed,
            });
          }
        }
      }
    } else if (fileName.endsWith('.csv')) {
      // Single CSV file - determine type by name or content
      const text = buffer.toString('utf-8');

      if (fileName.includes('watched')) {
        data.watched = parseCSV<LetterboxdRow>(text);
      } else if (fileName.includes('rating')) {
        data.ratings = parseCSV<LetterboxdRow>(text);
      } else if (fileName.includes('watchlist')) {
        data.watchlist = parseCSV<LetterboxdRow>(text);
      } else if (fileName.includes('review')) {
        data.reviews = parseCSV<LetterboxdReviewRow>(text);
      } else {
        // Default to watched
        data.watched = parseCSV<LetterboxdRow>(text);
      }
    } else {
      return { error: 'Invalid file type. Please upload a .zip or .csv file.' };
    }

    return { data };
  } catch (error) {
    console.error('[parseLetterboxdExport] Failed:', error);
    return { error: 'Failed to parse export file' };
  }
}

/**
 * Import movies from Letterboxd data.
 */
export async function importLetterboxdMovies(
  userId: string,
  letterboxdData: {
    watched: Array<{ Name: string; Year: string; Rating?: string }>;
    ratings: Array<{ Name: string; Year: string; Rating?: string }>;
    watchlist: Array<{ Name: string; Year: string }>;
    reviews?: Array<{ Name: string; Year: string; Rating?: string; Review?: string }>;
    favorites?: Array<{ Name: string; Year: string }>; // From profile favorites
    lists?: Array<{ name: string; description?: string; movies: Array<{ Name: string; Year: string }> }>; // User's custom lists
  },
  options: {
    importWatched: boolean;
    importRatings: boolean;
    importWatchlist: boolean;
    importReviews?: boolean;
    importLists?: boolean; // Import user's custom lists
  }
) {
  const db = getDb();
  const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;

  if (!TMDB_ACCESS_TOKEN) {
    return { error: 'TMDB not configured' };
  }

  try {
    // Get or create user's default list
    const listsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .where('isDefault', '==', true)
      .limit(1)
      .get();

    let listId: string;
    if (listsSnapshot.empty) {
      const listRef = db.collection('users').doc(userId).collection('lists').doc();
      await listRef.set({
        id: listRef.id,
        name: 'My Watchlist',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        isDefault: true,
        isPublic: false,
        ownerId: userId,
        collaboratorIds: [],
        movieCount: 0,
      });
      listId = listRef.id;
    } else {
      listId = listsSnapshot.docs[0].id;
    }

    // Get user data for denormalization
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Build ratings map for quick lookup
    const ratingsMap = new Map<string, number>();
    if (options.importRatings) {
      for (const row of letterboxdData.ratings) {
        if (row.Rating) {
          const key = `${row.Name.toLowerCase()}_${row.Year}`;
          ratingsMap.set(key, parseFloat(row.Rating) * 2); // Convert to /10
        }
      }
    }

    // Build reviews map for quick lookup
    const reviewsMap = new Map<string, string>();
    if (options.importReviews && letterboxdData.reviews) {
      for (const row of letterboxdData.reviews) {
        if (row.Review && row.Review.trim()) {
          const key = `${row.Name.toLowerCase()}_${row.Year}`;
          reviewsMap.set(key, row.Review.trim());
        }
      }
    }

    // Track top-rated movies for favorites (5 stars = 10/10)
    const topRatedMovies: Array<{
      id: string;
      title: string;
      posterUrl: string;
      tmdbId: number;
      rating: number;
    }> = [];

    // Collect all movies to import
    const moviesToProcess: Array<{
      name: string;
      year: string;
      status: 'Watched' | 'To Watch';
    }> = [];

    if (options.importWatched) {
      for (const row of letterboxdData.watched) {
        moviesToProcess.push({
          name: row.Name,
          year: row.Year,
          status: 'Watched',
        });
      }
    }

    if (options.importWatchlist) {
      for (const row of letterboxdData.watchlist) {
        // Skip if already in watched
        const alreadyWatched = letterboxdData.watched.some(
          w => w.Name === row.Name && w.Year === row.Year
        );
        if (!alreadyWatched) {
          moviesToProcess.push({
            name: row.Name,
            year: row.Year,
            status: 'To Watch',
          });
        }
      }
    }

    let importedCount = 0;
    const batches: FirebaseFirestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationCount = 0;

    // Process movies and match with TMDB
    for (const movie of moviesToProcess) {
      try {
        const query = encodeURIComponent(movie.name);
        const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${movie.year}&language=en-US&page=1`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) continue;

        const data = await response.json();
        const results = data.results || [];
        if (results.length === 0) continue;

        // Find best match (prefer exact year)
        const match = results.find((r: any) =>
          r.release_date?.startsWith(movie.year)
        ) || results[0];

        const docId = `movie_${match.id}`;
        const movieRef = db
          .collection('users')
          .doc(userId)
          .collection('lists')
          .doc(listId)
          .collection('movies')
          .doc(docId);

        currentBatch.set(movieRef, {
          id: docId,
          title: match.title,
          year: match.release_date?.slice(0, 4) || movie.year,
          posterUrl: match.poster_path
            ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
            : null,
          posterHint: match.title,
          addedBy: userId,
          status: movie.status,
          createdAt: FieldValue.serverTimestamp(),
          mediaType: 'movie',
          tmdbId: match.id,
          overview: match.overview || null,
          rating: match.vote_average || null,
          backdropUrl: match.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
            : null,
          addedByDisplayName: userData?.displayName || null,
          addedByUsername: userData?.username || null,
          addedByPhotoURL: userData?.photoURL || null,
        }, { merge: true });

        operationCount++;
        importedCount++;

        // Also create rating if applicable
        const ratingKey = `${movie.name.toLowerCase()}_${movie.year}`;
        const userRating = ratingsMap.get(ratingKey);
        if (userRating && options.importRatings) {
          const ratingRef = db.collection('ratings').doc(`${userId}_${match.id}`);
          currentBatch.set(ratingRef, {
            userId,
            tmdbId: match.id,
            mediaType: 'movie',
            movieTitle: match.title,
            moviePosterUrl: match.poster_path
              ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
              : null,
            rating: userRating,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          operationCount++;

          // Track top-rated (10/10 = 5 stars) for favorites
          if (userRating === 10) {
            topRatedMovies.push({
              id: docId,
              title: match.title,
              posterUrl: match.poster_path
                ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                : '',
              tmdbId: match.id,
              rating: userRating,
            });
          }
        }

        // Create review if applicable
        const userReview = reviewsMap.get(ratingKey);
        if (userReview && options.importReviews) {
          const reviewRef = db.collection('reviews').doc();
          currentBatch.set(reviewRef, {
            id: reviewRef.id,
            tmdbId: match.id,
            mediaType: 'movie',
            movieTitle: match.title,
            moviePosterUrl: match.poster_path
              ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
              : null,
            userId,
            username: userData?.username || null,
            userDisplayName: userData?.displayName || null,
            userPhotoUrl: userData?.photoURL || null,
            text: userReview,
            ratingAtTime: userRating || null,
            likes: 0,
            likedBy: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          operationCount++;
        }

        if (operationCount >= 450) {
          batches.push(currentBatch);
          currentBatch = db.batch();
          operationCount = 0;
        }

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        console.error(`Failed to process movie: ${movie.name}`, err);
        continue;
      }
    }

    if (operationCount > 0) {
      batches.push(currentBatch);
    }

    // Commit all batches
    for (const batch of batches) {
      await batch.commit();
    }

    // AUDIT.md 2.2: bulk imports can't be one transaction (500-op limit), so
    // instead of `increment(importedCount)` — which over-counts on re-import /
    // overlapping movies and drifts on partial failure — recount the
    // subcollection and SET the authoritative value. Idempotent + self-healing:
    // re-running an import converges movieCount to reality.
    const importedListRef = db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .doc(listId);
    const importedCountSnap = await importedListRef.collection('movies').count().get();
    await importedListRef.update({
      movieCount: importedCountSnap.data().count,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Import Letterboxd lists (create new lists with descriptions and movies)
    let listsCreated = 0;
    if (options.importLists && letterboxdData.lists && letterboxdData.lists.length > 0) {
      for (const lbList of letterboxdData.lists) {
        try {
          // Create the list
          const newListRef = db.collection('users').doc(userId).collection('lists').doc();
          await newListRef.set({
            id: newListRef.id,
            name: lbList.name,
            description: lbList.description || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            isDefault: false,
            isPublic: false, // Default to private, user can change later
            ownerId: userId,
            collaboratorIds: [],
            movieCount: 0,
          });

          // Import movies into this list
          let listMovieCount = 0;
          let listBatch = db.batch();
          let listBatchCount = 0;

          for (const movie of lbList.movies) {
            try {
              const query = encodeURIComponent(movie.Name);
              const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${movie.Year}&language=en-US&page=1`;

              const response = await fetch(url, {
                headers: {
                  Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
                  'Content-Type': 'application/json',
                },
              });

              if (!response.ok) continue;

              const tmdbData = await response.json();
              const results = tmdbData.results || [];
              if (results.length === 0) continue;

              const match = results.find((r: any) =>
                r.release_date?.startsWith(movie.Year)
              ) || results[0];

              const movieDocId = `movie_${match.id}`;
              const movieRef = db
                .collection('users')
                .doc(userId)
                .collection('lists')
                .doc(newListRef.id)
                .collection('movies')
                .doc(movieDocId);

              listBatch.set(movieRef, {
                id: movieDocId,
                title: match.title,
                year: match.release_date?.slice(0, 4) || movie.Year,
                posterUrl: match.poster_path
                  ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                  : null,
                posterHint: match.title,
                addedBy: userId,
                status: 'To Watch', // Default status for imported list movies
                createdAt: FieldValue.serverTimestamp(),
                mediaType: 'movie',
                tmdbId: match.id,
                overview: match.overview || null,
                rating: match.vote_average || null,
                backdropUrl: match.backdrop_path
                  ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
                  : null,
                addedByDisplayName: userData?.displayName || null,
                addedByUsername: userData?.username || null,
                addedByPhotoURL: userData?.photoURL || null,
              }, { merge: true });

              listBatchCount++;
              listMovieCount++;

              // Commit batch if reaching limit
              if (listBatchCount >= 450) {
                await listBatch.commit();
                listBatch = db.batch();
                listBatchCount = 0;
              }

              // Rate limiting
              await new Promise(resolve => setTimeout(resolve, 50));
            } catch (err) {
              console.error(`Failed to process movie for list ${lbList.name}: ${movie.Name}`, err);
              continue;
            }
          }

          // Commit remaining batch
          if (listBatchCount > 0) {
            await listBatch.commit();
          }

          // Update movie count on the new list
          if (listMovieCount > 0) {
            await newListRef.update({
              movieCount: listMovieCount,
            });
            listsCreated++;
          }
        } catch (err) {
          console.error(`Failed to create list: ${lbList.name}`, err);
          continue;
        }
      }
    }

    // Update user's favorite movies
    // Priority: 1) Letterboxd profile favorites, 2) 5-star rated movies as fallback
    let favoriteMoviesToSet: Array<{
      id: string;
      title: string;
      posterUrl: string;
      tmdbId: number;
    }> = [];

    // First, try to import Letterboxd profile favorites (up to 5)
    if (letterboxdData.favorites && letterboxdData.favorites.length > 0) {
      for (const fav of letterboxdData.favorites.slice(0, 5)) {
        try {
          const query = encodeURIComponent(fav.Name);
          const url = `https://api.themoviedb.org/3/search/movie?query=${query}&year=${fav.Year}&language=en-US&page=1`;

          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            const results = data.results || [];
            if (results.length > 0) {
              const match = results.find((r: any) =>
                r.release_date?.startsWith(fav.Year)
              ) || results[0];

              favoriteMoviesToSet.push({
                id: `movie_${match.id}`,
                title: match.title,
                posterUrl: match.poster_path
                  ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
                  : '',
                tmdbId: match.id,
              });
            }
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (err) {
          console.error(`Failed to match favorite: ${fav.Name}`, err);
        }
      }
    }

    // Fallback: Use 5-star rated movies if no favorites found
    if (favoriteMoviesToSet.length === 0 && topRatedMovies.length > 0) {
      favoriteMoviesToSet = topRatedMovies
        .slice(0, 5)
        .map(({ id, title, posterUrl, tmdbId }) => ({
          id,
          title,
          posterUrl,
          tmdbId,
        }));
    }

    // Update user's favorites if we found any
    if (favoriteMoviesToSet.length > 0) {
      await db.collection('users').doc(userId).update({
        favoriteMovies: favoriteMoviesToSet,
      });
    }

    // Mark onboarding as complete
    await db.collection('users').doc(userId).update({
      onboardingComplete: true,
    });

    return { success: true, importedCount, reviewsImported: reviewsMap.size, favoritesImported: favoriteMoviesToSet.length, listsCreated };
  } catch (error) {
    console.error('[importLetterboxdMovies] Failed:', error);
    return { error: 'Failed to import movies' };
  }
}

// ============================================
// END ONBOARDING ACTIONS
// ============================================

export async function backfillMovieUserData(adminSecret: string) {
  // AUDIT.md 1.8: this is a reachable server-action endpoint. The old code
  // accepted the literal "run-backfill-now" as a valid secret — anyone could
  // run it. Require strict equality with ADMIN_SECRET; fail closed if unset.
  const expected = process.env.ADMIN_SECRET;
  if (!expected || adminSecret !== expected) {
    return { error: 'Unauthorized' };
  }

  const db = getDb();
  const stats = {
    usersProcessed: 0,
    listsProcessed: 0,
    moviesProcessed: 0,
    moviesUpdated: 0,
    notesUpdated: 0,
    errors: [] as string[],
  };

  try {
    // Cache user profiles to avoid repeated lookups
    const userProfileCache = new Map<string, { username: string | null; displayName: string | null; photoURL: string | null }>();

    async function getUserData(uid: string) {
      if (userProfileCache.has(uid)) {
        return userProfileCache.get(uid)!;
      }

      const userDoc = await db.collection('users').doc(uid).get();
      const data = userDoc.exists ? userDoc.data() : null;
      const profile = {
        username: data?.username || null,
        displayName: data?.displayName || null,
        photoURL: data?.photoURL || null,
      };
      userProfileCache.set(uid, profile);
      return profile;
    }

    // Get all users
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      stats.usersProcessed++;
      const userId = userDoc.id;

      try {
        // Get all lists for this user
        const listsSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('lists')
          .get();

        for (const listDoc of listsSnapshot.docs) {
          stats.listsProcessed++;
          const listId = listDoc.id;

          try {
            // Get all movies in this list
            const moviesSnapshot = await db
              .collection('users')
              .doc(userId)
              .collection('lists')
              .doc(listId)
              .collection('movies')
              .get();

            for (const movieDoc of moviesSnapshot.docs) {
              stats.moviesProcessed++;
              const movieData = movieDoc.data();
              const updates: Record<string, unknown> = {};
              let needsUpdate = false;

              // Check if addedBy denormalization is needed
              if (movieData.addedBy && !movieData.addedByUsername) {
                const addedByUser = await getUserData(movieData.addedBy);
                updates.addedByUsername = addedByUser.username;
                updates.addedByDisplayName = addedByUser.displayName;
                updates.addedByPhotoURL = addedByUser.photoURL;
                needsUpdate = true;
              }

              // Check if notes need author denormalization
              if (movieData.notes && Object.keys(movieData.notes).length > 0) {
                const noteAuthors: Record<string, { username: string | null; displayName: string | null; photoURL: string | null }> =
                  movieData.noteAuthors || {};

                for (const noteAuthorUid of Object.keys(movieData.notes)) {
                  if (!noteAuthors[noteAuthorUid]) {
                    const authorData = await getUserData(noteAuthorUid);
                    noteAuthors[noteAuthorUid] = authorData;
                    stats.notesUpdated++;
                    needsUpdate = true;
                  }
                }

                if (needsUpdate && Object.keys(noteAuthors).length > 0) {
                  updates.noteAuthors = noteAuthors;
                }
              }

              // Apply updates if needed
              if (needsUpdate) {
                await movieDoc.ref.update(updates);
                stats.moviesUpdated++;
              }
            }
          } catch (listError) {
            stats.errors.push(`List ${listId}: ${String(listError)}`);
          }
        }
      } catch (userError) {
        stats.errors.push(`User ${userId}: ${String(userError)}`);
      }
    }

    return {
      success: true,
      stats,
      message: `Backfill complete. Updated ${stats.moviesUpdated} movies and ${stats.notesUpdated} notes.`,
    };
  } catch (error) {
    console.error('[backfillMovieUserData] Failed:', error);
    return {
      error: 'Backfill failed',
      details: String(error),
      stats,
    };
  }
}


/**
 * Backfill reviews with threading fields (parentId, replyCount).
 * Run this once after adding threading support to fix existing reviews.
 */
export async function backfillReviewsThreading() {
  const db = getDb();
  const stats = { updated: 0, skipped: 0, total: 0 };

  try {
    const reviewsSnapshot = await db.collection('reviews').get();
    stats.total = reviewsSnapshot.size;

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of reviewsSnapshot.docs) {
      const data = doc.data();

      // Only update if parentId is missing (not just null)
      if (data.parentId === undefined) {
        batch.update(doc.ref, {
          parentId: null,
          replyCount: data.replyCount ?? 0,
        });
        stats.updated++;
        batchCount++;
      } else {
        stats.skipped++;
      }

      // Firestore batches are limited to 500 operations
      if (batchCount >= 450) {
        await batch.commit();
        batchCount = 0;
      }
    }

    // Commit any remaining
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      success: true,
      message: `Backfill complete: ${stats.updated} reviews updated, ${stats.skipped} already had parentId`,
      stats,
    };
  } catch (error) {
    console.error('[backfillReviewsThreading] Failed:', error);
    return {
      error: 'Backfill failed',
      details: String(error),
      stats,
    };
  }
}

// --- NOTIFICATIONS ---

/**
 * Extract @mentions from text. Returns array of usernames (without @).
 */
function extractMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    if (!mentions.includes(username)) {
      mentions.push(username);
    }
  }
  return mentions;
}

/**
 * Create notifications for @mentions in a review.
 * Called internally when creating a review.
 */
async function createMentionNotifications(
  db: FirebaseFirestore.Firestore,
  reviewId: string,
  reviewText: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  fromUserId: string,
  fromUsername: string | null,
  fromDisplayName: string | null,
  fromPhotoUrl: string | null
) {
  const mentions = extractMentions(reviewText);
  if (mentions.length === 0) return;

  // Look up users by username (query users collection directly)
  const userLookups = mentions.map(username =>
    db.collection('users')
      .where('usernameLower', '==', username.toLowerCase())
      .limit(1)
      .get()
  );
  const userSnapshots = await Promise.all(userLookups);

  const batch = db.batch();
  const previewText = reviewText.slice(0, 100) + (reviewText.length > 100 ? '...' : '');

  for (let i = 0; i < userSnapshots.length; i++) {
    const snapshot = userSnapshots[i];
    if (snapshot.empty) continue;

    const userDoc = snapshot.docs[0];
    const mentionedUserId = userDoc.id; // Document ID is the user's uid
    const userData = userDoc.data();

    // Don't notify yourself
    if (mentionedUserId === fromUserId) continue;

    // Check if user has mentions notifications enabled
    const prefs = userData?.notificationPreferences;
    if (prefs && prefs.mentions === false) continue;

    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      id: notifRef.id,
      userId: mentionedUserId,
      type: 'mention',
      fromUserId,
      fromUsername,
      fromDisplayName,
      fromPhotoUrl,
      reviewId,
      tmdbId,
      mediaType,
      movieTitle,
      previewText,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Create a reply notification.
 */
async function createReplyNotification(
  db: FirebaseFirestore.Firestore,
  reviewId: string,
  reviewText: string,
  parentReview: { userId: string },
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  fromUserId: string,
  fromUsername: string | null,
  fromDisplayName: string | null,
  fromPhotoUrl: string | null
) {
  // Don't notify yourself
  if (parentReview.userId === fromUserId) return;

  // Check if user has replies notifications enabled
  const userDoc = await db.collection('users').doc(parentReview.userId).get();
  const prefs = userDoc.data()?.notificationPreferences;
  if (prefs && prefs.replies === false) return;

  const previewText = reviewText.slice(0, 100) + (reviewText.length > 100 ? '...' : '');

  await db.collection('notifications').add({
    userId: parentReview.userId,
    type: 'reply',
    fromUserId,
    fromUsername,
    fromDisplayName,
    fromPhotoUrl,
    reviewId,
    tmdbId,
    mediaType,
    movieTitle,
    previewText,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Get notifications for a user.
 */
export async function getNotifications(userId: string, limit: number = 50) {
  const db = getDb();

  try {
    const snapshot = await db
      .collection('notifications')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    // LAUNCH 0.5.5: drop notifications from blocked users (either direction).
    const blockSet = await getBlockSet(db, userId);

    const notifications = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          type: data.type,
          fromUserId: data.fromUserId,
          fromUsername: data.fromUsername,
          fromDisplayName: data.fromDisplayName,
          fromPhotoUrl: data.fromPhotoUrl,
          // Review context (optional)
          reviewId: data.reviewId,
          tmdbId: data.tmdbId,
          mediaType: data.mediaType,
          movieTitle: data.movieTitle,
          previewText: data.previewText,
          // List context (optional)
          listId: data.listId,
          listOwnerId: data.listOwnerId,
          listName: data.listName,
          inviteId: data.inviteId, // For accepting/declining list invites from notification
          // State
          read: data.read,
          createdAt: data.createdAt?.toDate() || new Date(),
        };
      })
      .filter((n) => !n.fromUserId || !blockSet.has(n.fromUserId));

    // Count unread
    const unreadCount = notifications.filter(n => !n.read).length;

    return { notifications, unreadCount };
  } catch (error: any) {
    console.error('[getNotifications] Failed:', error);
    // Include actual error message - may contain Firestore index creation URL
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    return { error: `Failed to fetch notifications: ${errorMessage}`, notifications: [], unreadCount: 0 };
  }
}

/**
 * Mark notifications as read.
 */
export async function markNotificationsRead(idToken: string, notificationIds?: string[]) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications
      const batch = db.batch();
      for (const id of notificationIds) {
        batch.update(db.collection('notifications').doc(id), { read: true });
      }
      await batch.commit();
    } else {
      // Mark all as read
      const snapshot = await db
        .collection('notifications')
        .where('userId', '==', userId)
        .where('read', '==', false)
        .get();

      if (snapshot.empty) return { success: true };

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { read: true });
      });
      await batch.commit();
    }

    return { success: true };
  } catch (error) {
    console.error('[markNotificationsRead] Failed:', error);
    return { error: 'Failed to mark notifications as read' };
  }
}

/**
 * Get unread notification count (lightweight).
 */
export async function getUnreadNotificationCount(userId: string) {
  const db = getDb();

  try {
    const snapshot = await db
      .collection('notifications')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .count()
      .get();

    return { count: snapshot.data().count };
  } catch (error) {
    console.error('[getUnreadNotificationCount] Failed:', error);
    return { count: 0 };
  }
}

// --- PUSH SUBSCRIPTIONS ---

/**
 * Save a push subscription for a user.
 */
export async function savePushSubscription(
  idToken: string,
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  // AUDIT.md 3.8: cap push-subscription churn.
  const rl = await checkRateLimit(userId, 'pushSubscribe');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    // Check if this endpoint already exists for this user
    const existing = await db
      .collection('users')
      .doc(userId)
      .collection('pushSubscriptions')
      .where('endpoint', '==', subscription.endpoint)
      .limit(1)
      .get();

    if (!existing.empty) {
      // Update existing subscription
      await existing.docs[0].ref.update({
        keys: subscription.keys,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Create new subscription
      await db
        .collection('users')
        .doc(userId)
        .collection('pushSubscriptions')
        .add({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    }

    // Also mark user as having push enabled
    await db.collection('users').doc(userId).update({
      pushEnabled: true,
    });

    return { success: true };
  } catch (error) {
    console.error('[savePushSubscription] Failed:', error);
    return { error: 'Failed to save push subscription' };
  }
}

/**
 * Remove a push subscription for a user.
 */
export async function removePushSubscription(idToken: string, endpoint: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('pushSubscriptions')
      .where('endpoint', '==', endpoint)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Check if user has any remaining subscriptions
    const remaining = await db
      .collection('users')
      .doc(userId)
      .collection('pushSubscriptions')
      .limit(1)
      .get();

    if (remaining.empty) {
      await db.collection('users').doc(userId).update({
        pushEnabled: false,
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[removePushSubscription] Failed:', error);
    return { error: 'Failed to remove push subscription' };
  }
}

/**
 * Check if user has push notifications enabled.
 */
export async function getPushStatus(userId: string) {
  const db = getDb();

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    return {
      enabled: userData?.pushEnabled || false,
    };
  } catch (error) {
    console.error('[getPushStatus] Failed:', error);
    return { enabled: false };
  }
}

// ============================================
// NOTIFICATION PREFERENCES
// ============================================

export async function getNotificationPreferences(userId: string) {
  const db = getDb();

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Return preferences or defaults
    return {
      preferences: userData?.notificationPreferences || {
        mentions: true,
        replies: true,
        likes: true,
        follows: true,
        listInvites: true,
        weeklyDigest: true,
      },
    };
  } catch (error) {
    console.error('[getNotificationPreferences] Failed:', error);
    return {
      preferences: {
        mentions: true,
        replies: true,
        likes: true,
        follows: true,
        listInvites: true,
        weeklyDigest: true,
      },
    };
  }
}

export async function updateNotificationPreferences(
  idToken: string,
  preferences: {
    mentions?: boolean;
    replies?: boolean;
    likes?: boolean;
    follows?: boolean;
    listInvites?: boolean;
    weeklyDigest?: boolean;
  }
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    // Get current preferences first
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const currentPrefs = userData?.notificationPreferences || {};

    // Merge with new preferences
    const updatedPrefs = {
      ...currentPrefs,
      ...preferences,
    };

    await db.collection('users').doc(userId).update({
      notificationPreferences: updatedPrefs,
    });

    return { success: true };
  } catch (error) {
    console.error('[updateNotificationPreferences] Failed:', error);
    return { error: 'Failed to update notification preferences' };
  }
}

// ============================================
// TRENDING MOVIES
// ============================================

export type TrendingMovie = {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
  mediaType: 'movie' | 'tv';
  imdbId?: string;
  imdbRating?: string;
};

// OMDB API key from environment variable (server-side only)
function getOmdbApiKey(): string {
  const key = process.env.OMDB_API_KEY;
  if (!key) {
    console.warn('[OMDB] API key not configured');
    return '';
  }
  return key;
}

async function fetchImdbRating(tmdbId: number, tmdbAccessToken: string): Promise<{ imdbId?: string; imdbRating?: string }> {
  const OMDB_API_KEY = getOmdbApiKey();
  if (!OMDB_API_KEY) return {};

  try {
    // First get IMDB ID from TMDB
    const externalIdsResponse = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`,
      {
        headers: {
          Authorization: `Bearer ${tmdbAccessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!externalIdsResponse.ok) return {};

    const externalIds = await externalIdsResponse.json();
    const imdbId = externalIds.imdb_id;

    if (!imdbId) return {};

    // Fetch OMDB data
    const omdbResponse = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`
    );

    if (!omdbResponse.ok) return { imdbId };

    const omdbData = await omdbResponse.json();

    return {
      imdbId,
      imdbRating: omdbData.imdbRating !== 'N/A' ? omdbData.imdbRating : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Get IMDB rating for a movie by IMDB ID.
 * This is a server action so the OMDB API key stays server-side.
 */
export async function getImdbRating(imdbId: string): Promise<{
  imdbRating?: string;
  metascore?: string;
  imdbVotes?: string;
  rated?: string;
  runtime?: string;
  error?: string;
}> {
  const OMDB_API_KEY = getOmdbApiKey();
  if (!OMDB_API_KEY) {
    return { error: 'OMDB API key not configured' };
  }

  try {
    const response = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`
    );

    if (!response.ok) {
      return { error: 'Failed to fetch OMDB data' };
    }

    const data = await response.json();

    if (data.Response === 'False') {
      return { error: data.Error || 'Movie not found' };
    }

    return {
      imdbRating: data.imdbRating !== 'N/A' ? data.imdbRating : undefined,
      metascore: data.Metascore !== 'N/A' ? data.Metascore : undefined,
      imdbVotes: data.imdbVotes !== 'N/A' ? data.imdbVotes : undefined,
      rated: data.Rated !== 'N/A' ? data.Rated : undefined,
      runtime: data.Runtime !== 'N/A' ? data.Runtime : undefined,
    };
  } catch (error) {
    console.error('[getImdbRating] Failed:', error);
    return { error: 'Failed to fetch IMDB rating' };
  }
}

export async function getTrendingMovies(): Promise<{ movies: TrendingMovie[]; error?: string }> {
  const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;

  if (!TMDB_ACCESS_TOKEN) {
    return { movies: [], error: 'TMDB not configured' };
  }

  try {
    const response = await fetch(
      'https://api.themoviedb.org/3/trending/movie/day?language=en-US',
      {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    const trendingResults = data.results.slice(0, 10);

    // Fetch IMDB ratings in parallel for all movies
    const imdbDataPromises = trendingResults.map((movie: any) =>
      fetchImdbRating(movie.id, TMDB_ACCESS_TOKEN)
    );
    const imdbDataResults = await Promise.all(imdbDataPromises);

    const movies: TrendingMovie[] = trendingResults.map((movie: any, index: number) => ({
      id: movie.id,
      title: movie.title || movie.name,
      posterPath: movie.poster_path,
      releaseDate: movie.release_date || movie.first_air_date || '',
      voteAverage: movie.vote_average,
      mediaType: 'movie' as const,
      imdbId: imdbDataResults[index].imdbId,
      imdbRating: imdbDataResults[index].imdbRating,
    }));

    return { movies };
  } catch (error) {
    console.error('[getTrendingMovies] Failed:', error);
    return { movies: [], error: 'Failed to fetch trending movies' };
  }
}

/**
 * Movies similar to a given title — TMDB `recommendations` (its own algorithm),
 * falling back to `similar` (genre/keyword based) when recommendations is empty.
 * Powers the "more like this" row on the movie-detail screen and the home
 * "if you liked X" feed cards. Cached 24h.
 */
export async function getSimilarMovies(
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'movie',
  limit = 12,
): Promise<{ movies: TrendingMovie[]; error?: string }> {
  const TMDB_ACCESS_TOKEN = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!TMDB_ACCESS_TOKEN) return { movies: [], error: 'TMDB not configured' };
  if (!tmdbId || Number.isNaN(tmdbId)) return { movies: [] };

  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const headers = {
    Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };

  async function fetchEndpoint(endpoint: 'recommendations' | 'similar') {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/${endpoint}?language=en-US&page=1`,
      { headers, next: { revalidate: 86400 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  }

  try {
    let results = await fetchEndpoint('recommendations');
    if (results.length === 0) results = await fetchEndpoint('similar');

    const movies: TrendingMovie[] = results
      .filter((m: { poster_path?: string | null }) => m.poster_path)
      .slice(0, limit)
      .map((m: Record<string, unknown>) => ({
        id: m.id as number,
        title: (m.title as string) || (m.name as string) || 'untitled',
        posterPath: (m.poster_path as string) ?? null,
        releaseDate: (m.release_date as string) || (m.first_air_date as string) || '',
        voteAverage: (m.vote_average as number) ?? 0,
        mediaType: (m.media_type === 'tv' || type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
      }));
    return { movies };
  } catch (error) {
    console.error('[getSimilarMovies] Failed:', error);
    return { movies: [], error: 'Failed to fetch similar movies.' };
  }
}

/** One "if you liked X" recommendation set for the home feed. */
export type RecommendationSet = {
  basisTmdbId: number;
  basisTitle: string;
  basisMediaType: 'movie' | 'tv';
  reason: string;
  recommendations: TrendingMovie[];
};

/**
 * "For you" recommendation sets for the home feed.
 *
 * Bases each set on one of the viewer's most-recent loved films (rating >= 8)
 * and pulls TMDB recommendations off it. Up to 3 sets so the feed can re-fire
 * "if you liked X" with a different basis film every few cards.
 */
export async function getRecommendationsForUser(
  idToken: string,
): Promise<{ sets: RecommendationSet[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { sets: [], error: auth.error };
  const userId = auth.uid;

  try {
    const { ratings } = await getUserRatings(userId, 40);
    const seen = new Set<number>();
    const bases = (ratings || [])
      .filter((r) => typeof r.rating === 'number' && r.rating >= 8 && !!r.tmdbId)
      .filter((r) => {
        if (seen.has(r.tmdbId)) return false;
        seen.add(r.tmdbId);
        return true;
      })
      .slice(0, 3);

    if (bases.length === 0) return { sets: [] };

    const sets = await Promise.all(
      bases.map(async (b): Promise<RecommendationSet> => {
        const { movies } = await getSimilarMovies(b.tmdbId, b.mediaType || 'movie', 9);
        return {
          basisTmdbId: b.tmdbId,
          basisTitle: b.movieTitle || 'a film you loved',
          basisMediaType: (b.mediaType || 'movie') as 'movie' | 'tv',
          reason: `more films in the orbit of ${(b.movieTitle || 'it').toLowerCase()}.`,
          recommendations: movies,
        };
      }),
    );
    return { sets: sets.filter((s) => s.recommendations.length > 0) };
  } catch (error) {
    console.error('[getRecommendationsForUser] Failed:', error);
    return { sets: [], error: 'Failed to build recommendations.' };
  }
}

// ============================================
// ACTIVITY FEED
// ============================================

/**
 * Create an activity entry (internal helper - not exported as server action)
 */
async function createActivity(
  db: FirebaseFirestore.Firestore,
  data: {
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
  }
) {
  try {
    // Get user data for denormalization
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
      // Use ?? null to convert undefined to null (Firestore rejects undefined)
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

/** Map an `activities` collection doc to the Activity type. */
function activityFromDoc(
  doc: FirebaseFirestore.DocumentSnapshot,
): Activity {
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

/**
 * Get global activity feed with pagination.
 */
export async function getActivityFeed(
  cursor?: string,
  limit: number = 20
): Promise<{ activities: Activity[]; hasMore: boolean; nextCursor?: string; error?: string }> {
  const db = getDb();

  try {
    let query = db
      .collection('activities')
      .orderBy('createdAt', 'desc')
      .limit(limit + 1); // Fetch one extra to determine if there's more

    // If cursor provided, start after that document
    if (cursor) {
      const cursorDoc = await db.collection('activities').doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs;

    // Check if there are more results
    const hasMore = docs.length > limit;
    const activitiesData = hasMore ? docs.slice(0, limit) : docs;

    const activities: Activity[] = activitiesData.map(activityFromDoc);

    return {
      activities,
      hasMore,
      nextCursor: hasMore ? activitiesData[activitiesData.length - 1].id : undefined,
    };
  } catch (error) {
    console.error('[getActivityFeed] Failed:', error);
    return { activities: [], hasMore: false, error: 'Failed to fetch activity feed' };
  }
}

// ============================================
// BOOKMARKS — the `saved` feed (LAUNCH 0.5 / Phase 5)
// ============================================

const SAVEABLE_TYPES = ['activity', 'post'] as const;

/** Save a feed item to the viewer's personal archive. Deterministic doc id. */
export async function saveItem(idToken: string, itemType: string, itemId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  if (!SAVEABLE_TYPES.includes(itemType as (typeof SAVEABLE_TYPES)[number]) || !itemId) {
    return { error: 'Invalid item.' };
  }
  const db = getDb();
  try {
    await db
      .collection('users').doc(auth.uid)
      .collection('bookmarks').doc(`${itemType}_${itemId}`)
      .set({ itemType, itemId, savedAt: FieldValue.serverTimestamp() });
    return { success: true };
  } catch (error) {
    console.error('[saveItem] Failed:', error);
    return { error: 'Failed to save.' };
  }
}

/** Remove a saved item. */
export async function unsaveItem(idToken: string, itemType: string, itemId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    await db
      .collection('users').doc(auth.uid)
      .collection('bookmarks').doc(`${itemType}_${itemId}`)
      .delete();
    return { success: true };
  } catch (error) {
    console.error('[unsaveItem] Failed:', error);
    return { error: 'Failed to unsave.' };
  }
}

/** All bookmark keys (`{type}_{id}`) for the viewer — powers the bookmarks cache. */
export async function getMyBookmarks(idToken: string): Promise<{ keys: string[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { keys: [], error: auth.error };
  const db = getDb();
  try {
    const snap = await db
      .collection('users').doc(auth.uid)
      .collection('bookmarks')
      .orderBy('savedAt', 'desc')
      .limit(1000)
      .get();
    return { keys: snap.docs.map((d) => d.id) };
  } catch (error) {
    console.error('[getMyBookmarks] Failed:', error);
    return { keys: [], error: 'Failed to load bookmarks.' };
  }
}

/**
 * The `saved` filter feed — re-hydrated saved items (activities + posts),
 * newest-saved first. Returns the FeedItem shape so the feed UI is shared.
 * Dangling bookmarks (deleted sources) are skipped.
 */
export async function getSavedFeed(
  idToken: string,
  cursor?: string,
  limit = 20,
): Promise<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { items: [], hasMore: false, error: auth.error };
  const db = getDb();
  try {
    const bookmarksCol = db.collection('users').doc(auth.uid).collection('bookmarks');
    let q = bookmarksCol.orderBy('savedAt', 'desc').limit(limit + 1);
    if (cursor) {
      const curDoc = await bookmarksCol.doc(cursor).get();
      if (curDoc.exists) q = q.startAfter(curDoc);
    }
    const snap = await q.get();
    const hasMore = snap.docs.length > limit;
    const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;

    const activityIds = docs
      .filter((d) => d.data().itemType === 'activity')
      .map((d) => d.data().itemId as string);
    const postIds = docs
      .filter((d) => d.data().itemType === 'post')
      .map((d) => d.data().itemId as string);

    const activityById = new Map<string, Activity>();
    const postById = new Map<string, Post>();
    if (activityIds.length) {
      const fetched = await db.getAll(
        ...activityIds.map((id) => db.collection('activities').doc(id)),
      );
      fetched.forEach((s) => {
        if (s.exists) activityById.set(s.id, activityFromDoc(s));
      });
    }
    if (postIds.length) {
      const fetched = await db.getAll(
        ...postIds.map((id) => db.collection('posts').doc(id)),
      );
      fetched.forEach((s) => {
        if (s.exists) postById.set(s.id, postFromDoc(s));
      });
    }

    const items: FeedItem[] = [];
    for (const d of docs) {
      const data = d.data();
      if (data.itemType === 'activity') {
        const a = activityById.get(data.itemId);
        if (a) items.push({ kind: 'activity', activity: a });
      } else if (data.itemType === 'post') {
        const p = postById.get(data.itemId);
        if (p) items.push({ kind: 'post', post: p });
      }
    }
    return {
      items,
      hasMore,
      nextCursor: hasMore ? docs[docs.length - 1]?.id : undefined,
    };
  } catch (error) {
    console.error('[getSavedFeed] Failed:', error);
    return { items: [], hasMore: false, error: 'Failed to load saved items.' };
  }
}

// ============================================
// MUTE — feed-hide a user (Phase 6)
// ============================================

/** Mute a user — their cards stop showing in the viewer's feed. */
export async function muteUser(idToken: string, mutedId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  if (!mutedId || mutedId === auth.uid) return { error: 'Invalid user.' };
  const db = getDb();
  try {
    await db
      .collection('users').doc(auth.uid)
      .collection('mutes').doc(mutedId)
      .set({ mutedId, createdAt: FieldValue.serverTimestamp() });
    return { success: true };
  } catch (error) {
    console.error('[muteUser] Failed:', error);
    return { error: 'Failed to mute.' };
  }
}

/** Unmute a previously muted user. */
export async function unmuteUser(idToken: string, mutedId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    await db
      .collection('users').doc(auth.uid)
      .collection('mutes').doc(mutedId)
      .delete();
    return { success: true };
  } catch (error) {
    console.error('[unmuteUser] Failed:', error);
    return { error: 'Failed to unmute.' };
  }
}

/** The viewer's muted-user ids — powers the mutes cache. */
export async function getMyMutes(idToken: string): Promise<{ mutedIds: string[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { mutedIds: [], error: auth.error };
  const db = getDb();
  try {
    const snap = await db.collection('users').doc(auth.uid).collection('mutes').get();
    return { mutedIds: snap.docs.map((d) => d.id) };
  } catch (error) {
    console.error('[getMyMutes] Failed:', error);
    return { mutedIds: [], error: 'Failed to load mutes.' };
  }
}

// ============================================
// FRIENDS ARE WATCHING — aggregated feed card (Phase 6)
// ============================================

/** A film 2+ followed users have recently touched — one aggregated hero card. */
export type FriendsWatchingCard = {
  tmdbId: number;
  movieTitle: string;
  moviePosterUrl: string | null;
  movieYear: string;
  mediaType: 'movie' | 'tv';
  friends: { uid: string; username: string | null; displayName: string | null; photoURL: string | null }[];
  avgRating: number | null;
  reviewCount: number;
};

/**
 * "Your circle is watching" — collapses recent followed-user activity by film.
 * A film touched by 2+ distinct followed users becomes one aggregated card so
 * the feed doesn't show the same title five times.
 */
export async function getFriendsWatching(
  idToken: string,
): Promise<{ cards: FriendsWatchingCard[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { cards: [], error: auth.error };
  const db = getDb();
  try {
    const followingSnap = await db
      .collection('users').doc(auth.uid).collection('following').get();
    const followingIds = new Set(followingSnap.docs.map((d) => d.id));
    if (followingIds.size === 0) return { cards: [] };

    const recent = await db
      .collection('activities')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const groups = new Map<number, FirebaseFirestore.DocumentData[]>();
    recent.docs.forEach((doc) => {
      const d = doc.data();
      if (!followingIds.has(d.userId) || !d.tmdbId) return;
      if (!groups.has(d.tmdbId)) groups.set(d.tmdbId, []);
      groups.get(d.tmdbId)!.push(d);
    });

    const cards: FriendsWatchingCard[] = [];
    for (const [tmdbId, acts] of groups) {
      const friendUids = [...new Set(acts.map((a) => a.userId as string))];
      if (friendUids.length < 2) continue;
      const friends = friendUids.map((uid) => {
        const a = acts.find((x) => x.userId === uid)!;
        return {
          uid,
          username: a.username ?? null,
          displayName: a.displayName ?? null,
          photoURL: a.photoURL ?? null,
        };
      });
      const ratings = acts
        .map((a) => a.rating)
        .filter((r): r is number => typeof r === 'number');
      const first = acts[0];
      cards.push({
        tmdbId,
        movieTitle: first.movieTitle ?? 'a film',
        moviePosterUrl: first.moviePosterUrl ?? null,
        movieYear: first.movieYear ?? '',
        mediaType: first.mediaType === 'tv' ? 'tv' : 'movie',
        friends,
        avgRating: ratings.length
          ? ratings.reduce((s, r) => s + r, 0) / ratings.length
          : null,
        reviewCount: acts.filter((a) => a.type === 'reviewed').length,
      });
    }
    cards.sort((a, b) => b.friends.length - a.friends.length);
    return { cards: cards.slice(0, 4) };
  } catch (error) {
    console.error('[getFriendsWatching] Failed:', error);
    return { cards: [], error: 'Failed to load friends-watching.' };
  }
}

// ============================================
// BLOCK — full mutual invisibility (LAUNCH 0.5.5)
// ============================================

/** True if a block exists in EITHER direction between two users. */
async function isBlockedBetween(
  db: FirebaseFirestore.Firestore,
  a: string,
  b: string,
): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    db.collection('blocks').doc(`${a}_${b}`).get(),
    db.collection('blocks').doc(`${b}_${a}`).get(),
  ]);
  return ab.exists || ba.exists;
}

/** The set of uids invisible to `uid` — everyone they blocked + everyone who
 *  blocked them. Used to filter server-side read surfaces. */
async function getBlockSet(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<Set<string>> {
  const [iBlocked, blockedMe] = await Promise.all([
    db.collection('blocks').where('blockerId', '==', uid).get(),
    db.collection('blocks').where('blockedId', '==', uid).get(),
  ]);
  const set = new Set<string>();
  iBlocked.docs.forEach((d) => set.add(d.data().blockedId as string));
  blockedMe.docs.forEach((d) => set.add(d.data().blockerId as string));
  return set;
}

/**
 * Block a user — full mutual invisibility. Also severs the relationship:
 * drops any follow in both directions (fixing counts) and revokes pending
 * invites between the two. Read-surface filtering is cross-cutting (see
 * getBlockSet callers + the client blocks cache).
 */
export async function blockUser(idToken: string, blockedId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const me = auth.uid;
  if (!blockedId || blockedId === me) return { error: 'Invalid user.' };
  const db = getDb();
  try {
    await db.collection('blocks').doc(`${me}_${blockedId}`).set({
      blockerId: me,
      blockedId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Sever the follow relationship in BOTH directions.
    const batch = db.batch();
    for (const [a, b] of [[me, blockedId], [blockedId, me]] as const) {
      const followingRef = db.collection('users').doc(a).collection('following').doc(b);
      if ((await followingRef.get()).exists) {
        batch.delete(followingRef);
        batch.delete(db.collection('users').doc(b).collection('followers').doc(a));
        batch.update(db.collection('users').doc(a), {
          followingCount: FieldValue.increment(-1),
        });
        batch.update(db.collection('users').doc(b), {
          followersCount: FieldValue.increment(-1),
        });
      }
    }
    await batch.commit();

    // Revoke pending invites between the two (best-effort).
    try {
      const pending = await db.collection('invites').where('status', '==', 'pending').get();
      const invBatch = db.batch();
      let touched = false;
      pending.docs.forEach((d) => {
        const inv = d.data();
        if (
          (inv.inviterId === me && inv.inviteeId === blockedId) ||
          (inv.inviterId === blockedId && inv.inviteeId === me)
        ) {
          invBatch.update(d.ref, { status: 'revoked' });
          touched = true;
        }
      });
      if (touched) await invBatch.commit();
    } catch (err) {
      console.error('[blockUser] invite revoke failed:', err);
    }

    return { success: true };
  } catch (error) {
    console.error('[blockUser] Failed:', error);
    return { error: 'Failed to block user.' };
  }
}

/** Unblock a user. The relationship is not restored — they must re-follow. */
export async function unblockUser(idToken: string, blockedId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    await db.collection('blocks').doc(`${auth.uid}_${blockedId}`).delete();
    return { success: true };
  } catch (error) {
    console.error('[unblockUser] Failed:', error);
    return { error: 'Failed to unblock user.' };
  }
}

/**
 * The viewer's block context — `blockedIds` is the invisibility union (filter
 * everything against it); `iBlocked` is who the viewer actively blocked (drives
 * the settings unblock list).
 */
export async function getMyBlockContext(
  idToken: string,
): Promise<{ blockedIds: string[]; iBlocked: string[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { blockedIds: [], iBlocked: [], error: auth.error };
  const db = getDb();
  try {
    const [iBlockedSnap, blockedMeSnap] = await Promise.all([
      db.collection('blocks').where('blockerId', '==', auth.uid).get(),
      db.collection('blocks').where('blockedId', '==', auth.uid).get(),
    ]);
    const iBlocked = iBlockedSnap.docs.map((d) => d.data().blockedId as string);
    const blockedMe = blockedMeSnap.docs.map((d) => d.data().blockerId as string);
    return { blockedIds: [...new Set([...iBlocked, ...blockedMe])], iBlocked };
  } catch (error) {
    console.error('[getMyBlockContext] Failed:', error);
    return { blockedIds: [], iBlocked: [], error: 'Failed to load block context.' };
  }
}

/** Profiles for the viewer's blocked users — drives the settings unblock list. */
export async function getBlockedUsers(
  idToken: string,
): Promise<{ users: UserProfile[]; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { users: [], error: auth.error };
  const db = getDb();
  try {
    const snap = await db.collection('blocks').where('blockerId', '==', auth.uid).get();
    const ids = snap.docs.map((d) => d.data().blockedId as string);
    if (ids.length === 0) return { users: [] };
    const docs = await db.getAll(...ids.map((id) => db.collection('users').doc(id)));
    const users = docs
      .filter((d) => d.exists)
      .map((d) => {
        const u = d.data() || {};
        return {
          uid: d.id,
          email: '',
          displayName: u.displayName ?? null,
          photoURL: u.photoURL ?? null,
          username: u.username ?? null,
          bio: u.bio ?? null,
          createdAt: u.createdAt?.toDate?.() ?? new Date(),
          followersCount: u.followersCount ?? 0,
          followingCount: u.followingCount ?? 0,
        } as UserProfile;
      });
    return { users };
  } catch (error) {
    console.error('[getBlockedUsers] Failed:', error);
    return { users: [], error: 'Failed to load blocked users.' };
  }
}

// ============================================
// USER POSTS (LAUNCH 0.5.4)
// ============================================

const MAX_POST_MEDIA_BYTES = 200 * 1024 * 1024; // 200MB — Twitter-class
const MAX_POST_TEXT = 2000;
const MAX_POST_MEDIA = 6;

/** Map a `posts` doc to the Post type. */
function postFromDoc(doc: FirebaseFirestore.DocumentSnapshot): Post {
  const d = doc.data() || {};
  return {
    id: doc.id,
    authorId: d.authorId,
    authorUsername: d.authorUsername ?? null,
    authorDisplayName: d.authorDisplayName ?? null,
    authorPhotoURL: d.authorPhotoURL ?? null,
    text: d.text ?? '',
    media: Array.isArray(d.media) ? d.media : [],
    taggedMovie: d.taggedMovie ?? null,
    taggedUserIds: d.taggedUserIds ?? [],
    taggedUsers: d.taggedUsers ?? [],
    place: d.place ?? null,
    likes: d.likes ?? 0,
    likedBy: d.likedBy ?? [],
    commentCount: d.commentCount ?? 0,
    createdAt: d.createdAt?.toDate?.() ?? new Date(),
    updatedAt: d.updatedAt?.toDate?.() ?? new Date(),
    editedAt: d.editedAt?.toDate?.() ?? null,
  };
}

/**
 * Issue a presigned R2 PUT URL so the client uploads post media (images +
 * video, up to 200MB) DIRECTLY to R2 — large files never stream through a
 * server action. Validates mime + size before signing.
 */
export async function getPostMediaUploadUrl(
  idToken: string,
  fileName: string,
  contentType: string,
  fileSize: number,
): Promise<{ uploadUrl?: string; publicUrl?: string; error?: string }> {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return { error: auth.error };

  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');
  if (!isImage && !isVideo) return { error: 'Only images and videos can be attached.' };
  if (!fileSize || fileSize <= 0 || fileSize > MAX_POST_MEDIA_BYTES) {
    return { error: 'That file is too large — 200MB max.' };
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName || !publicBaseUrl) {
    console.error('[getPostMediaUploadUrl] R2 not configured');
    return { error: 'Media upload is not configured.' };
  }

  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });

    const ext =
      (fileName.split('.').pop() || (isVideo ? 'mp4' : 'jpg'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || (isVideo ? 'mp4' : 'jpg');
    const key = `posts/${auth.uid}/${randomUUID()}.${ext}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType }),
      { expiresIn: 600 },
    );
    return { uploadUrl, publicUrl: `${publicBaseUrl}/${key}` };
  } catch (error) {
    console.error('[getPostMediaUploadUrl] Failed:', error);
    return { error: 'Failed to prepare the upload.' };
  }
}

/** Resolve tagged-user ids → denormalized TaggedUser[], dropping blocks + self. */
async function resolveTaggedUsers(
  db: FirebaseFirestore.Firestore,
  authorId: string,
  ids: string[] | undefined,
): Promise<TaggedUser[]> {
  const blockSet = await getBlockSet(db, authorId);
  const clean = [...new Set(ids || [])]
    .filter((id) => id && id !== authorId && !blockSet.has(id))
    .slice(0, 20);
  if (clean.length === 0) return [];
  const docs = await db.getAll(...clean.map((id) => db.collection('users').doc(id)));
  return docs
    .filter((d) => d.exists)
    .map((d) => {
      const t = d.data() || {};
      return {
        uid: d.id,
        username: t.username ?? null,
        displayName: t.displayName ?? null,
        photoURL: t.photoURL ?? null,
      };
    });
}

/** Create a user post (LAUNCH 0.5.4). Tagged friends are notified. */
export async function createPost(
  idToken: string,
  input: {
    text?: string;
    media?: PostMedia[];
    taggedMovie?: Post['taggedMovie'];
    taggedUserIds?: string[];
    place?: string;
  },
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const rl = await checkRateLimit(userId, 'post');
  if (!rl.ok) return { error: rl.error };

  const text = (input.text || '').trim().slice(0, MAX_POST_TEXT);
  const media = (Array.isArray(input.media) ? input.media : []).slice(0, MAX_POST_MEDIA);
  const taggedMovie = input.taggedMovie || null;
  const place = (input.place || '').trim().slice(0, 120) || null;

  if (!text && media.length === 0 && !taggedMovie) {
    return { error: 'Add a few words, a photo, or a film first.' };
  }

  const db = getDb();
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const u = userDoc.data() || {};
    const taggedUsers = await resolveTaggedUsers(db, userId, input.taggedUserIds);

    const postRef = db.collection('posts').doc();
    await postRef.set({
      id: postRef.id,
      authorId: userId,
      authorUsername: u.username ?? null,
      authorDisplayName: u.displayName ?? null,
      authorPhotoURL: u.photoURL ?? null,
      text,
      media,
      taggedMovie,
      taggedUserIds: taggedUsers.map((t) => t.uid),
      taggedUsers,
      place,
      likes: 0,
      likedBy: [],
      commentCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Notify tagged friends — best-effort, post-commit.
    for (const t of taggedUsers) {
      try {
        await db.collection('notifications').add({
          userId: t.uid,
          type: 'post_tag',
          fromUserId: userId,
          fromUsername: u.username ?? null,
          fromDisplayName: u.displayName ?? null,
          fromPhotoUrl: u.photoURL ?? null,
          postId: postRef.id,
          previewText: text.slice(0, 100),
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error('[createPost] tag notification failed:', err);
      }
    }

    return { success: true, postId: postRef.id };
  } catch (error) {
    console.error('[createPost] Failed:', error);
    return { error: 'Failed to create post.' };
  }
}

/** Edit a post (owner only). */
export async function updatePost(
  idToken: string,
  postId: string,
  input: {
    text?: string;
    media?: PostMedia[];
    taggedMovie?: Post['taggedMovie'];
    taggedUserIds?: string[];
    place?: string;
  },
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return { error: 'Post not found.' };
    if (snap.data()?.authorId !== auth.uid) {
      return { error: 'You can only edit your own posts.' };
    }
    const text = (input.text || '').trim().slice(0, MAX_POST_TEXT);
    const media = (Array.isArray(input.media) ? input.media : []).slice(0, MAX_POST_MEDIA);
    const taggedMovie = input.taggedMovie || null;
    const place = (input.place || '').trim().slice(0, 120) || null;
    if (!text && media.length === 0 && !taggedMovie) {
      return { error: 'A post needs words, a photo, or a film.' };
    }
    const taggedUsers = await resolveTaggedUsers(db, auth.uid, input.taggedUserIds);
    await ref.update({
      text,
      media,
      taggedMovie,
      taggedUserIds: taggedUsers.map((t) => t.uid),
      taggedUsers,
      place,
      updatedAt: FieldValue.serverTimestamp(),
      editedAt: FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error('[updatePost] Failed:', error);
    return { error: 'Failed to update post.' };
  }
}

/** Delete a post (owner only). */
export async function deletePost(idToken: string, postId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return { error: 'Post not found.' };
    if (snap.data()?.authorId !== auth.uid) {
      return { error: 'You can only delete your own posts.' };
    }
    await ref.delete();
    return { success: true };
  } catch (error) {
    console.error('[deletePost] Failed:', error);
    return { error: 'Failed to delete post.' };
  }
}

/** Fetch a single post — block-aware (returns null across a block). */
export async function getPost(
  postId: string,
  viewerIdToken?: string,
): Promise<{ post: Post | null; error?: string }> {
  const db = getDb();
  try {
    const snap = await db.collection('posts').doc(postId).get();
    if (!snap.exists) return { post: null };
    const post = postFromDoc(snap);
    if (viewerIdToken) {
      const viewer = await verifyCaller(viewerIdToken);
      if (!isAuthError(viewer) && (await isBlockedBetween(db, viewer.uid, post.authorId))) {
        return { post: null };
      }
    }
    return { post };
  } catch (error) {
    console.error('[getPost] Failed:', error);
    return { post: null, error: 'Failed to load post.' };
  }
}

/** A heterogeneous home-feed entry — a system activity or a user post. */
export type FeedItem =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'post'; post: Post };

/**
 * The unified home feed — merges /activities + /posts chronologically with a
 * timestamp cursor, and drops blocked users (either direction) server-side.
 */
export async function getHomeFeed(
  idToken: string,
  cursor?: string,
  limit = 20,
): Promise<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string; error?: string }> {
  const db = getDb();
  try {
    const auth = await verifyCaller(idToken);
    const blockSet = isAuthError(auth) ? new Set<string>() : await getBlockSet(db, auth.uid);
    const cursorDate = cursor ? new Date(cursor) : null;

    let actQ = db.collection('activities').orderBy('createdAt', 'desc');
    let postQ = db.collection('posts').orderBy('createdAt', 'desc');
    if (cursorDate) {
      actQ = actQ.where('createdAt', '<', cursorDate);
      postQ = postQ.where('createdAt', '<', cursorDate);
    }
    // Over-fetch activities — only `rated`/`reviewed` survive the type filter
    // below, so a `limit+1` fetch would routinely under-fill a page.
    const [actSnap, postSnap] = await Promise.all([
      actQ.limit(limit * 2 + 1).get(),
      postQ.limit(limit + 1).get(),
    ]);

    const merged = [
      ...actSnap.docs
        .map((d) => activityFromDoc(d))
        // The home feed carries opinions only — a rating is a verdict, a review
        // is a take. `added`/`watched` are low-signal logging and stay out.
        .filter((a) => a.type === 'rated' || a.type === 'reviewed')
        .map((a) => ({
          item: { kind: 'activity' as const, activity: a },
          ts: a.createdAt.getTime(),
          authorId: a.userId,
        })),
      ...postSnap.docs.map((d) => {
        const p = postFromDoc(d);
        return { item: { kind: 'post' as const, post: p }, ts: p.createdAt.getTime(), authorId: p.authorId };
      }),
    ]
      .filter((x) => !blockSet.has(x.authorId))
      .sort((a, b) => b.ts - a.ts);

    const hasMore = merged.length > limit;
    const page = merged.slice(0, limit);
    const nextCursor =
      hasMore && page.length > 0
        ? new Date(page[page.length - 1].ts).toISOString()
        : undefined;
    return { items: page.map((x) => x.item), hasMore, nextCursor };
  } catch (error) {
    console.error('[getHomeFeed] Failed:', error);
    return { items: [], hasMore: false, error: 'Failed to load the feed.' };
  }
}

/** Like a post. Mirrors the hardened likeReview pattern. */
export async function likePost(idToken: string, postId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;
  const rl = await checkRateLimit(userId, 'like');
  if (!rl.ok) return { error: rl.error };
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId);
    const tx = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { error: 'Post not found.' as const };
      const d = snap.data() || {};
      const likedBy: string[] = d.likedBy || [];
      if (likedBy.includes(userId)) return { error: 'Already liked.' as const };
      t.update(ref, {
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(userId),
      });
      return { ok: true as const, postData: d, newLikes: (d.likes || 0) + 1 };
    });
    if ('error' in tx) return { error: tx.error as string };

    if (tx.postData?.authorId && tx.postData.authorId !== userId) {
      try {
        const authorDoc = await db.collection('users').doc(tx.postData.authorId).get();
        const prefs = authorDoc.data()?.notificationPreferences;
        if (!prefs || prefs.likes !== false) {
          const likerDoc = await db.collection('users').doc(userId).get();
          const l = likerDoc.data();
          await db.collection('notifications').add({
            userId: tx.postData.authorId,
            type: 'post_like',
            fromUserId: userId,
            fromUsername: l?.username ?? null,
            fromDisplayName: l?.displayName ?? null,
            fromPhotoUrl: l?.photoURL ?? null,
            postId,
            previewText: (tx.postData.text || '').slice(0, 100),
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('[likePost] notification failed:', err);
      }
    }
    return { success: true, likes: tx.newLikes };
  } catch (error) {
    console.error('[likePost] Failed:', error);
    return { error: 'Failed to like post.' };
  }
}

/** Unlike a post. */
export async function unlikePost(idToken: string, postId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId);
    const tx = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { error: 'Post not found.' as const };
      const d = snap.data() || {};
      const likedBy: string[] = d.likedBy || [];
      if (!likedBy.includes(userId)) return { error: 'Not liked yet.' as const };
      t.update(ref, {
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(userId),
      });
      return { ok: true as const, newLikes: Math.max(0, (d.likes || 1) - 1) };
    });
    if ('error' in tx) return { error: tx.error as string };
    return { success: true, likes: tx.newLikes };
  } catch (error) {
    console.error('[unlikePost] Failed:', error);
    return { error: 'Failed to unlike post.' };
  }
}

// ============================================
// POST COMMENTS (LAUNCH 0.5.4 — Phase 10)
// ============================================

const MAX_COMMENT_TEXT = 1000;

/** Comment on a post (or reply to a comment — 1 level deep). */
export async function createPostComment(
  idToken: string,
  postId: string,
  text: string,
  parentId?: string | null,
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const rl = await checkRateLimit(userId, 'review');
  if (!rl.ok) return { error: rl.error };

  const trimmed = (text || '').trim().slice(0, MAX_COMMENT_TEXT);
  if (!trimmed) return { error: 'Write something first.' };

  const db = getDb();
  try {
    const postRef = db.collection('posts').doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) return { error: 'Post not found.' };
    const post = postSnap.data() || {};

    // LAUNCH 0.5.5: no commenting across a block.
    if (await isBlockedBetween(db, userId, post.authorId)) {
      return { error: 'You can’t comment on this post.' };
    }

    const userDoc = await db.collection('users').doc(userId).get();
    const u = userDoc.data() || {};
    const commentRef = postRef.collection('comments').doc();
    await commentRef.set({
      id: commentRef.id,
      postId,
      userId,
      username: u.username ?? null,
      userDisplayName: u.displayName ?? null,
      userPhotoUrl: u.photoURL ?? null,
      text: trimmed,
      likes: 0,
      likedBy: [],
      parentId: parentId || null,
      replyCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Counts.
    if (parentId) {
      try {
        await postRef.collection('comments').doc(parentId).update({
          replyCount: FieldValue.increment(1),
        });
      } catch (err) {
        console.error('[createPostComment] replyCount bump failed:', err);
      }
    } else {
      await postRef.update({ commentCount: FieldValue.increment(1) });
    }

    // Notify the post author (top-level) or the parent comment author (reply).
    let recipientId: string | null = post.authorId ?? null;
    if (parentId) {
      try {
        const parent = await postRef.collection('comments').doc(parentId).get();
        recipientId = (parent.data()?.userId as string) ?? null;
      } catch {
        /* fall back to the post author */
      }
    }
    if (recipientId && recipientId !== userId) {
      try {
        await db.collection('notifications').add({
          userId: recipientId,
          type: 'post_comment',
          fromUserId: userId,
          fromUsername: u.username ?? null,
          fromDisplayName: u.displayName ?? null,
          fromPhotoUrl: u.photoURL ?? null,
          postId,
          previewText: trimmed.slice(0, 100),
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error('[createPostComment] notification failed:', err);
      }
    }

    return { success: true, commentId: commentRef.id };
  } catch (error) {
    console.error('[createPostComment] Failed:', error);
    return { error: 'Failed to post comment.' };
  }
}

/** All comments on a post (flat, oldest-first), block-filtered. */
export async function getPostComments(
  postId: string,
  viewerIdToken?: string,
): Promise<{ comments: PostComment[]; error?: string }> {
  const db = getDb();
  try {
    let blockSet = new Set<string>();
    if (viewerIdToken) {
      const v = await verifyCaller(viewerIdToken);
      if (!isAuthError(v)) blockSet = await getBlockSet(db, v.uid);
    }
    const snap = await db
      .collection('posts').doc(postId)
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .limit(300)
      .get();
    const comments: PostComment[] = snap.docs
      .map((d) => {
        const c = d.data();
        return {
          id: d.id,
          postId,
          userId: c.userId,
          username: c.username ?? null,
          userDisplayName: c.userDisplayName ?? null,
          userPhotoUrl: c.userPhotoUrl ?? null,
          text: c.text ?? '',
          likes: c.likes ?? 0,
          likedBy: c.likedBy ?? [],
          parentId: c.parentId ?? null,
          replyCount: c.replyCount ?? 0,
          createdAt: c.createdAt?.toDate?.() ?? new Date(),
        };
      })
      .filter((c) => !blockSet.has(c.userId));
    return { comments };
  } catch (error) {
    console.error('[getPostComments] Failed:', error);
    return { comments: [], error: 'Failed to load comments.' };
  }
}

/** Delete a post comment — the comment's author or the post's author. */
export async function deletePostComment(idToken: string, postId: string, commentId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const db = getDb();
  try {
    const postRef = db.collection('posts').doc(postId);
    const commentRef = postRef.collection('comments').doc(commentId);
    const [postSnap, commentSnap] = await Promise.all([postRef.get(), commentRef.get()]);
    if (!commentSnap.exists) return { error: 'Comment not found.' };
    const comment = commentSnap.data() || {};
    const isCommentAuthor = comment.userId === auth.uid;
    const isPostAuthor = postSnap.data()?.authorId === auth.uid;
    if (!isCommentAuthor && !isPostAuthor) {
      return { error: 'You can only delete your own comments.' };
    }
    await commentRef.delete();
    if (comment.parentId) {
      try {
        await postRef.collection('comments').doc(comment.parentId).update({
          replyCount: FieldValue.increment(-1),
        });
      } catch {
        /* parent may be gone */
      }
    } else {
      await postRef.update({ commentCount: FieldValue.increment(-1) });
    }
    return { success: true };
  } catch (error) {
    console.error('[deletePostComment] Failed:', error);
    return { error: 'Failed to delete comment.' };
  }
}

/** Like a post comment (transactional). */
export async function likePostComment(idToken: string, postId: string, commentId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;
  const rl = await checkRateLimit(userId, 'like');
  if (!rl.ok) return { error: rl.error };
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    const tx = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { error: 'Comment not found.' as const };
      const likedBy: string[] = snap.data()?.likedBy || [];
      if (likedBy.includes(userId)) return { error: 'Already liked.' as const };
      t.update(ref, {
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(userId),
      });
      return { ok: true as const, newLikes: (snap.data()?.likes || 0) + 1 };
    });
    if ('error' in tx) return { error: tx.error as string };
    return { success: true, likes: tx.newLikes };
  } catch (error) {
    console.error('[likePostComment] Failed:', error);
    return { error: 'Failed to like comment.' };
  }
}

/** Unlike a post comment. */
export async function unlikePostComment(idToken: string, postId: string, commentId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;
  const db = getDb();
  try {
    const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    const tx = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { error: 'Comment not found.' as const };
      const likedBy: string[] = snap.data()?.likedBy || [];
      if (!likedBy.includes(userId)) return { error: 'Not liked yet.' as const };
      t.update(ref, {
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(userId),
      });
      return { ok: true as const, newLikes: Math.max(0, (snap.data()?.likes || 1) - 1) };
    });
    if ('error' in tx) return { error: tx.error as string };
    return { success: true, likes: tx.newLikes };
  } catch (error) {
    console.error('[unlikePostComment] Failed:', error);
    return { error: 'Failed to unlike comment.' };
  }
}

/**
 * Like an activity.
 */
export async function likeActivity(idToken: string, activityId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  // AUDIT.md 3.8: cap scripted like spam.
  const rl = await checkRateLimit(userId, 'like');
  if (!rl.ok) return { error: rl.error };

  const db = getDb();

  try {
    const activityRef = db.collection('activities').doc(activityId);

    // AUDIT.md 3.5: atomic read-check-write (see likeReview).
    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(activityRef);
      if (!snap.exists) return { error: 'Activity not found.' as const };
      const data = snap.data() || {};
      const likedBy: string[] = data.likedBy || [];
      if (likedBy.includes(userId)) return { error: 'Already liked.' as const };
      tx.update(activityRef, {
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(userId),
      });
      return { ok: true as const, newLikes: (data.likes || 0) + 1 };
    });
    // txResult.error is `string` at runtime in this branch; the `| undefined`
    // is only a TS union-normalization artifact (the ok-variant never carries
    // `error`). The cast keeps the function's return type clean.
    if ('error' in txResult) return { error: txResult.error as string };

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[likeActivity] Failed:', error);
    return { error: 'Failed to like activity.' };
  }
}

/**
 * Unlike an activity.
 */
export async function unlikeActivity(idToken: string, activityId: string) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;
  const userId = auth.uid;

  const db = getDb();

  try {
    const activityRef = db.collection('activities').doc(activityId);

    // AUDIT.md 3.5: atomic read-check-write (see likeReview).
    const txResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(activityRef);
      if (!snap.exists) return { error: 'Activity not found.' as const };
      const data = snap.data() || {};
      const likedBy: string[] = data.likedBy || [];
      if (!likedBy.includes(userId)) return { error: 'Not liked.' as const };
      tx.update(activityRef, {
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(userId),
      });
      return { ok: true as const, newLikes: Math.max(0, (data.likes || 0) - 1) };
    });
    // txResult.error is `string` at runtime in this branch; the `| undefined`
    // is only a TS union-normalization artifact (the ok-variant never carries
    // `error`). The cast keeps the function's return type clean.
    if ('error' in txResult) return { error: txResult.error as string };

    return { success: true, likes: txResult.newLikes };
  } catch (error) {
    console.error('[unlikeActivity] Failed:', error);
    return { error: 'Failed to unlike activity.' };
  }
}

/**
 * AUDIT.md (App Store §1.2 — User-Generated Content): lets a user report
 * objectionable content (a review/comment, another user, or a list). Apple
 * requires UGC apps to provide a reporting mechanism; reports land in the
 * server-only `/reports` collection for the developer to review and act on.
 *
 * Rate-limited to stop report-spam / harassment-by-mass-report.
 */
export async function reportContent(
  idToken: string,
  contentType: 'review' | 'user' | 'list' | 'post' | 'post_comment',
  targetId: string,
  reason: string,
) {
  const auth = await verifyCaller(idToken);
  if (isAuthError(auth)) return auth;

  const rl = await checkRateLimit(auth.uid, 'report');
  if (!rl.ok) return { error: rl.error };

  if (!targetId || !['review', 'user', 'list'].includes(contentType)) {
    return { error: 'Invalid report.' };
  }

  const db = getDb();
  try {
    await db.collection('reports').add({
      reporterId: auth.uid,
      contentType,
      targetId,
      reason: (reason || '').trim().slice(0, 1000),
      status: 'pending', // pending → reviewed → actioned/dismissed
      createdAt: FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error('[reportContent] Failed:', error);
    return { error: 'Failed to submit report.' };
  }
}
