'use server';

import { revalidatePath } from 'next/cache';
import type { SearchResult, UserProfile, ListInvite, ListMember, Activity, ActivityType } from '@/lib/types';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp } from '@/firebase/admin';

// --- HELPER ---
function getDb() {
  const adminApp = getFirebaseAdminApp();
  return getFirestore(adminApp);
}

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
export async function createUserProfile(userId: string, email: string, displayName: string | null) {
  const db = getDb();

  try {
    // Generate unique username
    const username = await generateUniqueUsername(db, email, displayName);

    // Create user profile document
    const userRef = db.collection('users').doc(userId);
    await userRef.set({
      uid: userId,
      email: email,
      emailLower: email.toLowerCase(),
      displayName: displayName,
      displayNameLower: displayName?.toLowerCase() || null,
      photoURL: null,
      username: username,
      usernameLower: username.toLowerCase(),
      followersCount: 0,
      followingCount: 0,
      createdAt: FieldValue.serverTimestamp(),
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
 * Ensures a user has a profile and default list (for existing users).
 * Also migrates existing users to have social fields.
 */
export async function ensureUserProfile(userId: string, email: string, displayName: string | null) {
  const db = getDb();

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // Create profile if it doesn't exist
      return await createUserProfile(userId, email, displayName);
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
      await userRef.update({
        username: username,
        usernameLower: username.toLowerCase(),
        emailLower: (userData?.email || email).toLowerCase(),
        displayNameLower: (userData?.displayName || displayName)?.toLowerCase() || null,
        followersCount: userData?.followersCount ?? 0,
        followingCount: userData?.followingCount ?? 0,
      });
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
export async function createList(userId: string, name: string, isPublic: boolean = true) {
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
export async function renameList(userId: string, listOwnerId: string, listId: string, newName: string) {
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
export async function updateListDescription(userId: string, listOwnerId: string, listId: string, description: string) {
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
export async function updateListVisibility(userId: string, listOwnerId: string, listId: string, isPublic: boolean) {
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
export async function deleteList(userId: string, listOwnerId: string, listId: string) {
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
    const movieData = JSON.parse(formData.get('movieData') as string) as SearchResult;
    const userId = formData.get('userId') as string;
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
    const movieDoc: Record<string, unknown> = {
      id: docId,
      title: movieData.title,
      year: movieData.year,
      posterUrl: movieData.posterUrl,
      posterHint: movieData.posterHint,
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

    // Check if movie already exists (to avoid double-counting)
    const existingDoc = await movieRef.get();
    const isNewMovie = !existingDoc.exists;

    await movieRef.set(movieDoc, { merge: true });

    // Update list's updatedAt and increment movieCount if new
    const listRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId);

    if (isNewMovie) {
      await listRef.update({
        updatedAt: FieldValue.serverTimestamp(),
        movieCount: FieldValue.increment(1),
      });

      // Create activity for new movie additions
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
    } else {
      await listRef.update({
        updatedAt: FieldValue.serverTimestamp(),
      });
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
  userId: string,
  listOwnerId: string,
  listId: string,
  movieId: string
) {
  const db = getDb();

  try {
    // Check if user can edit this list (owner or collaborator)
    const canEdit = await canEditList(userId, listOwnerId, listId);
    if (!canEdit) {
      return { error: 'You do not have permission to remove movies from this list.' };
    }

    const movieRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .doc(movieId);

    await movieRef.delete();

    // Update list's updatedAt and decrement movieCount
    await db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .update({
        updatedAt: FieldValue.serverTimestamp(),
        movieCount: FieldValue.increment(-1),
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
  userId: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
  status: 'To Watch' | 'Watched'
) {
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
  userId: string,
  listOwnerId: string,
  listId: string,
  movieId: string,
  note: string
) {
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

/**
 * Legacy addMovie function for backward compatibility.
 * Adds movie to user's default list.
 */
export async function addMovie(formData: FormData) {
  const db = getDb();

  try {
    const movieData = JSON.parse(formData.get('movieData') as string) as SearchResult;
    const addedBy = formData.get('addedBy') as string;
    const socialLink = formData.get('socialLink') as string;

    if (!movieData || !addedBy) {
      throw new Error('Missing movie data or user ID.');
    }

    // Find user's default list
    const listsSnapshot = await db
      .collection('users')
      .doc(addedBy)
      .collection('lists')
      .where('isDefault', '==', true)
      .limit(1)
      .get();

    let listId: string;

    if (listsSnapshot.empty) {
      // Create default list if none exists
      const result = await ensureUserProfile(addedBy, '', null);
      if ('error' in result || !result.defaultListId) {
        throw new Error('Could not find or create default list.');
      }
      listId = result.defaultListId;
    } else {
      listId = listsSnapshot.docs[0].id;
    }

    // Add movie to the default list
    const newFormData = new FormData();
    newFormData.append('movieData', JSON.stringify(movieData));
    newFormData.append('userId', addedBy);
    newFormData.append('listId', listId);
    newFormData.append('socialLink', socialLink || '');

    return await addMovieToList(newFormData);
  } catch (error) {
    console.error('Failed to add movie:', error);
    return { error: 'Failed to add movie.' };
  }
}

/**
 * Migrates movies from the old structure to a list.
 * Old: users/{userId}/movies/{movieId}
 * New: users/{userId}/lists/{listId}/movies/{movieId}
 */
export async function migrateMoviesToList(userId: string, listId: string) {
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
  const db = getDb();

  try {
    if (!query || query.length < 2) {
      return { users: [] };
    }

    const queryLower = query.toLowerCase().trim();
    const usersMap = new Map<string, UserProfile>();
    const usersToMigrate: Array<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }> = [];

    // Fetch all users and filter client-side
    // For apps with <1000 users, this is pragmatic and reliable
    const allUsersSnapshot = await db.collection('users').get();

    console.log(`[searchUsers] Query: "${queryLower}", Total users in DB: ${allUsersSnapshot.size}`);

    allUsersSnapshot.docs.forEach((doc) => {
      const data = doc.data();

      // Skip current user
      const docUid = data.uid || doc.id;
      if (docUid === currentUserId) return;

      // Track users needing migration
      if (!data.usernameLower && data.username) {
        usersToMigrate.push({ ref: doc.ref, data });
      }

      // Use pre-normalized fields if available, otherwise normalize on the fly
      const username = data.usernameLower || (data.username || '').toLowerCase();
      const email = data.emailLower || (data.email || '').toLowerCase();
      const displayName = data.displayNameLower || (data.displayName || '').toLowerCase();

      // Check if any field contains or starts with the query
      const matchesUsername = username && (username.includes(queryLower) || username.startsWith(queryLower));
      const matchesEmail = email && (email.includes(queryLower) || email.split('@')[0].includes(queryLower));
      const matchesDisplayName = displayName && displayName.includes(queryLower);

      if (matchesUsername || matchesEmail || matchesDisplayName) {
        // Convert Firestore Timestamp to ISO string for serialization
        const userProfile: UserProfile = {
          uid: docUid,
          email: data.email || '',
          displayName: data.displayName || null,
          photoURL: data.photoURL || null,
          username: data.username || null,
          bio: data.bio || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          followersCount: data.followersCount || 0,
          followingCount: data.followingCount || 0,
        };
        usersMap.set(docUid, userProfile);
      }
    });

    // Migrate users missing normalized fields (fire and forget, capped at 10)
    const MAX_MIGRATIONS_PER_SEARCH = 10;
    if (usersToMigrate.length > 0) {
      const toMigrate = usersToMigrate.slice(0, MAX_MIGRATIONS_PER_SEARCH);
      console.log(`[searchUsers] Migrating ${toMigrate.length} of ${usersToMigrate.length} users with missing normalized fields`);
      Promise.all(
        toMigrate.map(({ ref, data }) =>
          ref.update({
            usernameLower: data.username.toLowerCase(),
            emailLower: (data.email || '').toLowerCase(),
            displayNameLower: data.displayName?.toLowerCase() || null,
          }).catch((err) => console.error(`[searchUsers] Migration failed for ${ref.id}:`, err))
        )
      ).catch(() => { /* ignore batch errors */ });
    }

    console.log(`[searchUsers] Found ${usersMap.size} matching users`);

    // Sort by relevance: exact username match first, then prefix match, then contains
    const users = Array.from(usersMap.values())
      .sort((a, b) => {
        const aUsername = (a.username || '').toLowerCase();
        const bUsername = (b.username || '').toLowerCase();

        // Exact match comes first
        if (aUsername === queryLower && bUsername !== queryLower) return -1;
        if (bUsername === queryLower && aUsername !== queryLower) return 1;

        // Prefix match comes next
        if (aUsername.startsWith(queryLower) && !bUsername.startsWith(queryLower)) return -1;
        if (bUsername.startsWith(queryLower) && !aUsername.startsWith(queryLower)) return 1;

        return 0;
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
export async function updateUsername(userId: string, newUsername: string) {
  const db = getDb();

  try {
    const username = newUsername.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (username.length < 3) {
      return { error: 'Username must be at least 3 characters.' };
    }

    if (username.length > 20) {
      return { error: 'Username must be 20 characters or less.' };
    }

    // Check if username is taken
    const existing = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (!existing.empty && existing.docs[0].id !== userId) {
      return { error: 'Username is already taken.' };
    }

    await db.collection('users').doc(userId).update({
      username: username,
    });

    revalidatePath('/profile');
    return { success: true, username };
  } catch (error) {
    console.error('Failed to update username:', error);
    return { error: 'Failed to update username.' };
  }
}

/**
 * Delete a user account and all associated data.
 * This is a destructive operation that cannot be undone.
 */
export async function deleteUserAccount(userId: string, confirmUsername: string) {
  const db = getDb();
  const adminApp = getFirebaseAdminApp();
  const auth = getAuth(adminApp);

  try {
    // First, verify the user exists and username matches
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

    // 4. Remove user from any lists they collaborate on
    const allUsersSnapshot = await db.collection('users').get();
    for (const userDocSnapshot of allUsersSnapshot.docs) {
      if (userDocSnapshot.id === userId) continue;

      const listsSnapshot = await userDocSnapshot.ref.collection('lists')
        .where('collaboratorIds', 'array-contains', userId)
        .get();

      for (const listDoc of listsSnapshot.docs) {
        await listDoc.ref.update({
          collaboratorIds: FieldValue.arrayRemove(userId),
        });
      }
    }
    console.log(`[deleteUserAccount] Removed from collaborations`);

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
export async function followUser(followerId: string, followingId: string) {
  const db = getDb();

  try {
    if (followerId === followingId) {
      return { error: "You can't follow yourself." };
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
export async function unfollowUser(followerId: string, followingId: string) {
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
      isDefault: listData?.isDefault || false,
      isPublic: listData?.isPublic || false,
      ownerId: listData?.ownerId,
      collaboratorIds: listData?.collaboratorIds || [],
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
export async function toggleListVisibility(userId: string, listOwnerId: string, listId: string) {
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
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
export async function inviteToList(inviterId: string, listOwnerId: string, listId: string, inviteeId: string) {
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
export async function createInviteLink(inviterId: string, listOwnerId: string, listId: string) {
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
export async function getListPendingInvites(userId: string, listOwnerId: string, listId: string) {
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
        inviteCode: data.inviteCode,
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
export async function acceptInvite(userId: string, inviteId?: string, inviteCode?: string) {
  const db = getDb();

  try {
    let inviteDoc;
    let inviteRef;

    if (inviteId) {
      inviteRef = db.collection('invites').doc(inviteId);
      inviteDoc = await inviteRef.get();
    } else if (inviteCode) {
      const inviteSnapshot = await db.collection('invites')
        .where('inviteCode', '==', inviteCode)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (inviteSnapshot.empty) {
        return { error: 'Invite not found or has expired.' };
      }

      inviteDoc = inviteSnapshot.docs[0];
      inviteRef = inviteDoc.ref;
    } else {
      return { error: 'No invite specified.' };
    }

    if (!inviteDoc.exists) {
      return { error: 'Invite not found.' };
    }

    const inviteData = inviteDoc.data();

    // Check if invite is for this user (for in-app invites)
    if (inviteData?.inviteeId && inviteData.inviteeId !== userId) {
      return { error: 'This invite is for another user.' };
    }

    // Check if invite is pending
    if (inviteData?.status !== 'pending') {
      return { error: 'This invite is no longer valid.' };
    }

    // Check expiration for link invites
    if (inviteData?.expiresAt && inviteData.expiresAt.toDate() < new Date()) {
      return { error: 'This invite has expired.' };
    }

    // Get list and check max members
    const listRef = db.collection('users').doc(inviteData.listOwnerId).collection('lists').doc(inviteData.listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List no longer exists.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Check if already a collaborator
    if (collaboratorIds.includes(userId) || userId === inviteData.listOwnerId) {
      await inviteRef.update({ status: 'accepted' });
      return { error: 'You are already a member of this list.' };
    }

    // Check max members
    if (collaboratorIds.length + 1 >= MAX_LIST_MEMBERS) {
      return { error: 'This list has reached the maximum number of members.' };
    }

    // Add user as collaborator
    await listRef.update({
      collaboratorIds: FieldValue.arrayUnion(userId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update invite status
    await inviteRef.update({
      status: 'accepted',
      inviteeId: userId, // Set for link invites
    });

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
export async function declineInvite(userId: string, inviteId: string) {
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

    return { success: true };
  } catch (error) {
    console.error('[declineInvite] Failed:', error);
    return { error: 'Failed to decline invite.' };
  }
}

/**
 * Revoke an invite (owner only).
 */
export async function revokeInvite(userId: string, inviteId: string) {
  const db = getDb();

  try {
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      return { error: 'Invite not found.' };
    }

    const inviteData = inviteDoc.data();

    // Only inviter (owner) can revoke
    if (inviteData?.inviterId !== userId) {
      return { error: 'Only the list owner can revoke invites.' };
    }

    await inviteRef.update({ status: 'revoked' });

    return { success: true };
  } catch (error) {
    console.error('[revokeInvite] Failed:', error);
    return { error: 'Failed to revoke invite.' };
  }
}

/**
 * Remove a collaborator from a list (owner only).
 */
export async function removeCollaborator(ownerId: string, listId: string, collaboratorId: string) {
  const db = getDb();

  try {
    const listRef = db.collection('users').doc(ownerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();

    // Check if user is owner
    if (listData?.ownerId !== ownerId) {
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
export async function leaveList(userId: string, listOwnerId: string, listId: string) {
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
export async function transferOwnership(currentOwnerId: string, listId: string, newOwnerId: string) {
  const db = getDb();

  try {
    const listRef = db.collection('users').doc(currentOwnerId).collection('lists').doc(listId);
    const listDoc = await listRef.get();

    if (!listDoc.exists) {
      return { error: 'List not found.' };
    }

    const listData = listDoc.data();
    const collaboratorIds: string[] = listData?.collaboratorIds || [];

    // Check if new owner is a collaborator
    if (!collaboratorIds.includes(newOwnerId)) {
      return { error: 'New owner must be an existing collaborator.' };
    }

    // Get all movies in the list
    const moviesSnapshot = await listRef.collection('movies').get();

    // Create new list under new owner
    const newListRef = db.collection('users').doc(newOwnerId).collection('lists').doc(listId);

    // Update collaborators: remove new owner, add old owner
    const newCollaborators = collaboratorIds.filter(id => id !== newOwnerId);
    newCollaborators.push(currentOwnerId);

    await newListRef.set({
      ...listData,
      ownerId: newOwnerId,
      collaboratorIds: newCollaborators,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Copy all movies to new location
    const batch = db.batch();
    for (const movieDoc of moviesSnapshot.docs) {
      const newMovieRef = newListRef.collection('movies').doc(movieDoc.id);
      batch.set(newMovieRef, movieDoc.data());
    }
    await batch.commit();

    // Delete old list and movies
    const deleteBatch = db.batch();
    for (const movieDoc of moviesSnapshot.docs) {
      deleteBatch.delete(movieDoc.ref);
    }
    deleteBatch.delete(listRef);
    await deleteBatch.commit();

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
  userId: string,
  base64Data: string,
  fileName: string,
  mimeType: string
): Promise<{ url?: string; error?: string }> {
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
export async function updateProfilePhoto(userId: string, photoURL: string) {
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
export async function updateBio(userId: string, bio: string) {
  const db = getDb();

  try {
    // Limit bio length
    const trimmedBio = bio.trim().slice(0, 160);

    await db.collection('users').doc(userId).update({
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
  userId: string,
  favoriteMovies: Array<{ id: string; title: string; posterUrl: string; tmdbId: number }>
) {
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
export async function getListPreview(userId: string, listId: string) {
  const db = getDb();

  try {
    // Get the first 4 movies from the list for preview posters
    const moviesSnapshot = await db
      .collection('users')
      .doc(userId)
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
      .doc(userId)
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
export async function getListsPreviews(userId: string, listIds: string[]) {
  const db = getDb();
  const previews: Record<string, { previewPosters: string[]; movieCount: number }> = {};

  try {
    // Fetch previews for all lists in parallel
    const results = await Promise.all(
      listIds.map(async (listId) => {
        const result = await getListPreview(userId, listId);
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
 * Upload list cover image to R2.
 */
export async function uploadListCover(
  userId: string,
  listId: string,
  base64Data: string,
  fileName: string,
  mimeType: string
): Promise<{ url?: string; error?: string }> {
  try {
    // Validate inputs
    if (!userId || !listId || !base64Data) {
      return { error: 'Missing required fields.' };
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

    console.log('[uploadListCover] Starting upload for user:', userId, 'list:', listId);

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
    const fileKey = `covers/${userId}/${listId}/cover.${ext}`;

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
        .doc(userId)
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
export async function updateListCover(userId: string, listId: string, coverImageUrl: string | null) {
  const db = getDb();

  try {
    await db
      .collection('users')
      .doc(userId)
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
  userId: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  moviePosterUrl: string | undefined,
  text: string,
  ratingAtTime?: number | null, // Optional: pass the current user rating to snapshot
  parentId?: string | null // Optional: if replying to another review
) {
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
export async function likeReview(userId: string, reviewId: string) {
  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return { error: 'Review not found.' };
    }

    const reviewData = reviewDoc.data();
    const likedBy = reviewData?.likedBy || [];

    if (likedBy.includes(userId)) {
      return { error: 'Already liked.' };
    }

    await reviewRef.update({
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(userId),
    });

    // Create like notification (don't notify yourself)
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

    return { success: true, likes: (reviewData?.likes || 0) + 1 };
  } catch (error) {
    console.error('[likeReview] Failed:', error);
    return { error: 'Failed to like review.' };
  }
}

/**
 * Unlike a review.
 */
export async function unlikeReview(userId: string, reviewId: string) {
  const db = getDb();

  try {
    const reviewRef = db.collection('reviews').doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return { error: 'Review not found.' };
    }

    const reviewData = reviewDoc.data();
    const likedBy = reviewData?.likedBy || [];

    if (!likedBy.includes(userId)) {
      return { error: 'Not liked yet.' };
    }

    await reviewRef.update({
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(userId),
    });

    return { success: true, likes: Math.max(0, (reviewData?.likes || 1) - 1) };
  } catch (error) {
    console.error('[unlikeReview] Failed:', error);
    return { error: 'Failed to unlike review.' };
  }
}

/**
 * Delete a review (only by owner).
 */
export async function deleteReview(userId: string, reviewId: string) {
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
export async function updateReview(userId: string, reviewId: string, text: string) {
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
  userId: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  movieTitle: string,
  moviePosterUrl: string | undefined,
  rating: number
) {
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
export async function deleteRating(userId: string, tmdbId: number) {
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
export async function getUserRatings(userId: string, limit: number = 100) {
  const db = getDb();

  try {
    const snapshot = await db
      .collection('ratings')
      .where('userId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

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
  userId: string,
  email: string,
  username: string,
  displayName: string | null
) {
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
      // Create new profile
      await userRef.set({
        uid: userId,
        email: email,
        emailLower: email.toLowerCase(),
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

    // Update movie count on list
    await db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .doc(listId)
      .update({
        movieCount: FieldValue.increment(importedCount),
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

    // Update movie count on list
    await db
      .collection('users')
      .doc(userId)
      .collection('lists')
      .doc(listId)
      .update({
        movieCount: FieldValue.increment(importedCount),
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
  // Simple protection against accidental runs
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'run-backfill-now') {
    return { error: 'Invalid admin secret. Pass "run-backfill-now" to confirm.' };
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

    const notifications = snapshot.docs.map(doc => {
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
        // State
        read: data.read,
        createdAt: data.createdAt?.toDate() || new Date(),
      };
    });

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
export async function markNotificationsRead(userId: string, notificationIds?: string[]) {
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
  userId: string,
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
) {
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
export async function removePushSubscription(userId: string, endpoint: string) {
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
  userId: string,
  preferences: {
    mentions?: boolean;
    replies?: boolean;
    likes?: boolean;
    follows?: boolean;
    listInvites?: boolean;
    weeklyDigest?: boolean;
  }
) {
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

    const activities: Activity[] = activitiesData.map(doc => {
      const data = doc.data();
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
        createdAt: data.createdAt?.toDate() || new Date(),
      };
    });

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

/**
 * Like an activity.
 */
export async function likeActivity(userId: string, activityId: string) {
  const db = getDb();

  try {
    const activityRef = db.collection('activities').doc(activityId);
    const activityDoc = await activityRef.get();

    if (!activityDoc.exists) {
      return { error: 'Activity not found.' };
    }

    const activityData = activityDoc.data();
    const likedBy = activityData?.likedBy || [];

    if (likedBy.includes(userId)) {
      return { error: 'Already liked.' };
    }

    await activityRef.update({
      likes: FieldValue.increment(1),
      likedBy: FieldValue.arrayUnion(userId),
    });

    return { success: true, likes: (activityData?.likes || 0) + 1 };
  } catch (error) {
    console.error('[likeActivity] Failed:', error);
    return { error: 'Failed to like activity.' };
  }
}

/**
 * Unlike an activity.
 */
export async function unlikeActivity(userId: string, activityId: string) {
  const db = getDb();

  try {
    const activityRef = db.collection('activities').doc(activityId);
    const activityDoc = await activityRef.get();

    if (!activityDoc.exists) {
      return { error: 'Activity not found.' };
    }

    const activityData = activityDoc.data();
    const likedBy = activityData?.likedBy || [];

    if (!likedBy.includes(userId)) {
      return { error: 'Not liked.' };
    }

    await activityRef.update({
      likes: FieldValue.increment(-1),
      likedBy: FieldValue.arrayRemove(userId),
    });

    return { success: true, likes: Math.max(0, (activityData?.likes || 0) - 1) };
  } catch (error) {
    console.error('[unlikeActivity] Failed:', error);
    return { error: 'Failed to unlike activity.' };
  }
}
