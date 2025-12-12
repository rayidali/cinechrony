'use server';

import { revalidatePath } from 'next/cache';
import type { SearchResult, UserProfile, ListInvite, ListMember } from '@/lib/types';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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

    const movieRef = db
      .collection('users')
      .doc(listOwnerId)
      .collection('lists')
      .doc(listId)
      .collection('movies')
      .doc(movieData.id);

    await movieRef.set(
      {
        id: movieData.id,
        title: movieData.title,
        year: movieData.year,
        posterUrl: movieData.posterUrl,
        posterHint: movieData.posterHint,
        addedBy: userId, // Track who added the movie
        socialLink: socialLink || '',
        status: 'To Watch',
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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

    revalidatePath(`/lists/${listId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to update movie status:', error);
    return { error: 'Failed to update movie status.' };
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
export async function searchUsers(query: string, currentUserId: string) {
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
        const userProfile: UserProfile = {
          uid: docUid,
          email: data.email || '',
          displayName: data.displayName || null,
          photoURL: data.photoURL || null,
          username: data.username || null,
          createdAt: data.createdAt?.toDate?.() || new Date(),
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

    const movies = moviesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return {
      list: { id: listDoc.id, ...listData },
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

const MAX_LIST_MEMBERS = 3; // Owner + 2 collaborators

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
    const members: ListMember[] = [];

    // Get owner profile
    const ownerDoc = await db.collection('users').doc(listOwnerId).get();
    if (ownerDoc.exists) {
      const ownerData = ownerDoc.data();
      members.push({
        uid: listOwnerId,
        username: ownerData?.username || null,
        displayName: ownerData?.displayName || null,
        photoURL: ownerData?.photoURL || null,
        role: 'owner',
      });
    }

    // Get collaborator profiles
    for (const collabId of collaboratorIds) {
      const collabDoc = await db.collection('users').doc(collabId).get();
      if (collabDoc.exists) {
        const collabData = collabDoc.data();
        members.push({
          uid: collabId,
          username: collabData?.username || null,
          displayName: collabData?.displayName || null,
          photoURL: collabData?.photoURL || null,
          role: 'collaborator',
        });
      }
    }

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
 * Get lists where user is a collaborator (not owner).
 */
export async function getCollaborativeLists(userId: string) {
  const db = getDb();

  try {
    // Query all lists where user is in collaboratorIds
    // Note: This requires checking across all users' lists, which isn't efficient
    // For now, we'll store a reference in the user's document or use a separate collection

    // Alternative approach: Query the invites collection for accepted invites
    const acceptedInvites = await db.collection('invites')
      .where('inviteeId', '==', userId)
      .where('status', '==', 'accepted')
      .get();

    const lists = [];

    for (const inviteDoc of acceptedInvites.docs) {
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
          // Convert Firestore Timestamps to ISO strings for serialization
          lists.push({
            id: listDoc.id,
            name: listData.name,
            ownerId: inviteData.listOwnerId,
            ownerUsername: inviteData.inviterUsername,
            ownerDisplayName: inviteData.inviterDisplayName || inviteData.inviterUsername,
            isPublic: listData.isPublic,
            isDefault: listData.isDefault || false,
            collaboratorIds: listData.collaboratorIds || [],
            createdAt: listData.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            updatedAt: listData.updatedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          });
        }
      }
    }

    return { lists };
  } catch (error) {
    console.error('[getCollaborativeLists] Failed:', error);
    return { error: 'Failed to get collaborative lists.', lists: [] };
  }
}
