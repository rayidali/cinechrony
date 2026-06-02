'use server';

import { revalidatePath } from 'next/cache';
import type {
  SearchResult, UserProfile, ListInvite, ListMember, Activity, ActivityType,
  Post, PostMedia, TaggedUser,
} from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp, getDb } from '@/firebase/admin';
import { verifyCaller, isAuthError } from '@/lib/auth-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { createActivity, activityFromDoc } from '@/lib/activities-server';
import { postFromDoc, type FeedItem } from '@/lib/posts-server';
import { isBlockedBetween, getBlockSet } from '@/lib/blocks-server';
import {
  createMentionNotifications,
  createReplyNotification,
  extractMentions,
} from '@/lib/notifications-server';
import { getUserRatings as getUserRatingsLib } from '@/lib/ratings-server';
import { randomUUID } from 'node:crypto';

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


// --- MOVIE OPERATIONS ---
// Phase A PR #4 (LAUNCH.md A.3.8–A.3.12): five Server Actions were migrated to
// /api/v1 routes — see `src/lib/movies-server.ts` and the route files at
// `src/app/api/v1/lists/[ownerId]/[listId]/movies/`. Deleted:
//   - addMovieToList       → POST   /api/v1/lists/[ownerId]/[listId]/movies
//   - removeMovieFromList  → DELETE /api/v1/lists/[ownerId]/[listId]/movies/[movieId]
//   - updateMovieStatus    → PATCH  /api/v1/lists/[ownerId]/[listId]/movies/[movieId] (status)
//   - updateMovieNote      → PATCH  /api/v1/lists/[ownerId]/[listId]/movies/[movieId] (note) — closes AUDIT 1.6
//   - migrateMoviesToList  → deleted entirely (legacy one-shot data migration; no remaining callers)
// AUDIT 2.2 (transactional movieCount) lives in `movies-server.ts`.

// --- SOCIAL FEATURES ---

// searchUsers moved to `src/lib/search-server.ts` in Phase A PR #14.
// Route: GET /api/v1/users/search?q=...   (publicApiRoute; auth-aware —
// excludes self + applies block-filter when a Bearer token is present).
// The AUDIT.md 2.8 prefix-range optimization is preserved verbatim.

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


// Phase A PR #7 (LAUNCH.md A.3.26–A.3.27): four follow actions migrated to
// /api/v1 routes — see `src/lib/follows-server.ts` and the route files
// under `src/app/api/v1/users/[uid]/`. Deleted:
//   - followUser       → POST   /api/v1/users/[uid]/follow      (AUDIT 3.8 rate-limited)
//   - unfollowUser     → DELETE /api/v1/users/[uid]/follow      (idempotent, fixes count-drift bug)
//   - getFollowers     → GET    /api/v1/users/[uid]/followers
//   - getFollowing     → GET    /api/v1/users/[uid]/following
//
// `isFollowing` STAYS in this file for now — it's a single boolean read
// used by `<FollowButton>`. It will fold into the user-profile fetch when
// PR #11 migrates `getUserByUsername`/`getUserProfile`. Keeping it here
// is intentional (inventory note: "folded into profile fetch").


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
  /** v3: when 'auto', render the mosaic even if coverImageUrl is set. */
  coverMode: 'auto' | 'custom' | null;
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
        coverMode: (d.coverMode as 'auto' | 'custom' | undefined) ?? null,
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


// --- COLLABORATIVE LISTS ---


// --- COLLABORATIVE LISTS ---
// Phase A PR #5 (LAUNCH.md A.3.13–A.3.18): the eight invite actions were
// migrated to /api/v1 routes — see `src/lib/invites-server.ts` and the route
// files under `src/app/api/v1/invites/`,
// `src/app/api/v1/lists/[ownerId]/[listId]/invites/`,
// `src/app/api/v1/lists/[ownerId]/[listId]/invite-link/`, and
// `src/app/api/v1/me/invites/`. Deleted:
//   - inviteToList          → POST   /api/v1/lists/[ownerId]/[listId]/invites
//   - createInviteLink      → POST   /api/v1/lists/[ownerId]/[listId]/invite-link
//   - getInviteByCode       → GET    /api/v1/invites/[code]  (auth required — AUDIT 2.9)
//   - getMyPendingInvites   → GET    /api/v1/me/invites
//   - getListPendingInvites → GET    /api/v1/lists/[ownerId]/[listId]/invites  (AUDIT 1.14)
//   - acceptInvite          → POST   /api/v1/invites/accept  (AUDIT 1.11, transactional)
//   - declineInvite         → POST   /api/v1/invites/[inviteId]/decline
//   - revokeInvite          → DELETE /api/v1/invites/[inviteId]  (AUDIT 1.12 — owner OR inviter)
//
// `MAX_LIST_MEMBERS` and `generateInviteCode` moved into the lib modules
// (lists-server.ts and invites-server.ts respectively).

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

// Phase A PR #6 (LAUNCH.md A.3.6): removeCollaborator + leaveList migrated
// to /api/v1 routes — see `src/lib/collaborators-server.ts` and
// `src/app/api/v1/lists/[ownerId]/[listId]/collaborators/[uid]/route.ts`
// (DELETE) + `.../leave/route.ts` (POST). Closes AUDIT.md 1.4 — caller
// identity comes from the verified token; the stored ownerId is the
// comparison anchor.


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
// --- REVIEWS ---


// Phase A PR #8 (LAUNCH.md A.3.28–A.3.33 + AUDIT 2.6, 3.5, 3.10): eight
// review actions migrated to /api/v1 routes — see
// `src/lib/reviews-server.ts` and the route files under
// `src/app/api/v1/reviews/`. Deleted:
//   - createReview          → POST   /api/v1/reviews  (rate-limited, AUDIT 3.8)
//   - getMovieReviews       → GET    /api/v1/reviews?tmdbId=&sort=&cursor=  (cursor pagination — AUDIT 3.10)
//   - getReviewReplies      → GET    /api/v1/reviews/[id]/replies?cursor=
//   - updateReview          → PATCH  /api/v1/reviews/[id]  (real edit — AUDIT 2.6)
//   - deleteReview          → DELETE /api/v1/reviews/[id]
//   - likeReview            → POST   /api/v1/reviews/[id]/like  (transactional — AUDIT 3.5)
//   - unlikeReview          → DELETE /api/v1/reviews/[id]/like  (transactional)
//   - getUserReviewForMovie → GET    /api/v1/reviews/by-user?userId=&tmdbId=
//
// `likeList` / `unlikeList` (just below) stay until PR #9 — they share the
// like-counter infrastructure but live in the list domain.


// Phase A PR #9 (LAUNCH.md A.3.34–A.3.35 + LAUNCH 0.5.1): six actions
// migrated to /api/v1 routes — see `src/lib/ratings-server.ts`,
// `src/lib/lists-server.ts` (like/unlike additions), and the route files.
// Deleted:
//   - likeList            → POST   /api/v1/lists/[ownerId]/[listId]/like   (rate-limited, transactional)
//   - unlikeList          → DELETE /api/v1/lists/[ownerId]/[listId]/like   (transactional)
//   - createOrUpdateRating → POST  /api/v1/ratings  (1–10 validation, 'rated' activity on first rating)
//   - getUserRating       → GET    /api/v1/ratings/by-user?userId=&tmdbId=
//   - deleteRating        → DELETE /api/v1/ratings/[tmdbId]
//   - getUserRatings      → GET    /api/v1/users/[uid]/ratings?cursor=  (AUDIT 2.5 pagination)


// --- ADMIN BACKFILLS ---
// All four backfill actions (backfillEmailPrivacy, backfillUserSearchFields,
// backfillMovieUserData, backfillReviewsThreading) moved to
// `src/lib/admin-backfills-server.ts` in Phase A PR #16, behind
// /api/v1/admin/* routes. AUDIT 1.8 closed end-to-end: one ADMIN_SECRET
// env var, one check at the route layer via `adminRoute` (constant-time
// compare; fails closed if env unset in production). The legacy
// "run-backfill-now" sentinel + the dual ADMIN_SECRET_TOKEN env var are gone.


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



// --- NOTIFICATIONS / PUSH / PREFERENCES ---
// All read + management surface migrated to /api/v1 in Phase A PR #13.
// Internal write helpers (extractMentions, createMentionNotifications,
// createReplyNotification, etc.) live in `src/lib/notifications-server.ts`
// and are imported at the top of this file. Migrated endpoints:
//   GET    /api/v1/notifications                   listNotifications (cursor-paginated)
//   GET    /api/v1/notifications/unread-count      getUnreadNotificationCount
//   POST   /api/v1/notifications/read              markNotificationsRead
//   POST   /api/v1/me/push-subscription            savePushSubscription (rate-limited)
//   DELETE /api/v1/me/push-subscription            removePushSubscription
//   GET    /api/v1/me/push-status                  getPushStatus
//   GET    /api/v1/me/notification-preferences     getNotificationPreferences
//   PATCH  /api/v1/me/notification-preferences     updateNotificationPreferences
//
// These migrations also close a pre-existing auth gap: the legacy
// getNotifications / getUnreadNotificationCount / getPushStatus /
// getNotificationPreferences actions took a plain userId arg with no
// server-side identity check, so any client could read any user's
// notifications/push state. The new routes derive UID from the verified
// Bearer token only.
// --- TRENDING / SIMILAR / OMDB / RECOMMENDATIONS ---
// All migrated to /api/v1 in Phase A PR #14. Logic + the `TrendingMovie` and
// `RecommendationSet` types live in `src/lib/tmdb-server.ts`. Routes:
//   GET /api/v1/movies/trending                        getTrendingMovies (public)
//   GET /api/v1/movies/[tmdbId]/similar?mediaType=...  getSimilarMovies (public)
//   GET /api/v1/movies/imdb-rating/[imdbId]            getImdbRating (public, OMDB key server-only)
//   GET /api/v1/recommendations                        getRecommendationsForUser (Bearer auth)


// ============================================
// ACTIVITY FEED
// ============================================

// Phase A PR #4: createActivity moved to `src/lib/activities-server.ts` so the
// /api/v1 routes can import it without dragging this 'use server' module into
// their graph (which would turn every export here into a Server Action).
// Imported at the top of the file alongside the other lib helpers.


// activityFromDoc + getActivityFeed moved to src/lib/activities-server.ts
// in Phase A PR #10. Imported at the top alongside createActivity.


// --- BOOKMARKS / MUTES / BLOCK / FRIENDS-WATCHING ---
// All migrated to /api/v1 in Phase A PR #15. Helpers + types live in:
//   src/lib/bookmarks-server.ts        (saveItem, unsaveItem, getMyBookmarks, getSavedFeed)
//   src/lib/mutes-server.ts            (muteUser, unmuteUser, getMyMutes)
//   src/lib/blocks-server.ts           (blockUser, unblockUser, getMyBlockContext, getBlockedUsers — extended)
//   src/lib/friends-watching-server.ts (getFriendsWatching + FriendsWatchingCard type)
// Routes:
//   POST   /api/v1/bookmarks                              saveItem
//   GET    /api/v1/bookmarks                              getMyBookmarks (cache hydrator)
//   DELETE /api/v1/bookmarks/[itemType]/[itemId]          unsaveItem
//   GET    /api/v1/saved-feed?cursor=&limit=              getSavedFeed (hydrated, cursor-paginated)
//   POST   /api/v1/users/[uid]/mute                       muteUser
//   DELETE /api/v1/users/[uid]/mute                       unmuteUser
//   GET    /api/v1/me/mutes                               getMyMutes
//   POST   /api/v1/users/[uid]/block                      blockUser (severs follows, revokes invites)
//   DELETE /api/v1/users/[uid]/block                      unblockUser (no follow restore)
//   GET    /api/v1/me/block-context                       getMyBlockContext
//   GET    /api/v1/me/blocked-users                       getBlockedUsers
//   GET    /api/v1/friends-watching                       getFriendsWatching (Bearer auth)

// ============================================
// USER POSTS (LAUNCH 0.5.4) — Phase A PR #11
// ============================================
// Eight post actions + postFromDoc + resolveTaggedUsers + MAX_POST_*
// constants + FeedItem type all moved to `src/lib/posts-server.ts`. Routes:
//   POST   /api/v1/posts                      createPost  (rate-limited)
//   GET    /api/v1/posts/[id]                 getPost     (block-aware)
//   PATCH  /api/v1/posts/[id]                 updatePost  (owner-only)
//   DELETE /api/v1/posts/[id]                 deletePost  (owner-only)
//   POST   /api/v1/posts/media-upload-url     getPostMediaUploadUrl  (uid-scoped R2 key)
//   POST   /api/v1/posts/[id]/like            likePost    (transactional, AUDIT 3.5)
//   DELETE /api/v1/posts/[id]/like            unlikePost  (transactional)
//   GET    /api/v1/home-feed?cursor=          getHomeFeed (activities + posts, block-filtered)


// ============================================
// POST COMMENTS (LAUNCH 0.5.4 — Phase 10)
// ============================================

// createPostComment / getPostComments / deletePostComment / likePostComment /
// unlikePostComment all moved to src/lib/post-comments-server.ts in Phase A
// PR #12 (closes the post-comment leg of the lists-rebuild migration). Routes:
//   POST   /api/v1/posts/[id]/comments              (rate-limited, block-aware)
//   GET    /api/v1/posts/[id]/comments              (public, block-filtered)
//   DELETE /api/v1/posts/[id]/comments/[cid]        (author OR post-author)
//   POST   /api/v1/posts/[id]/comments/[cid]/like   (rate-limited, transactional)
//   DELETE /api/v1/posts/[id]/comments/[cid]/like   (transactional)


// likeActivity + unlikeActivity moved to src/lib/activities-server.ts in
// Phase A PR #10 (closes AUDIT 3.5 activity-like leg). Routes:
//   POST   /api/v1/activities/[id]/like   (rate-limited, transactional)
//   DELETE /api/v1/activities/[id]/like   (transactional)


// reportContent moved to `src/lib/reports-server.ts` in Phase A PR #15.
// Route: POST /api/v1/reports  body { contentType, targetId, reason }.
// AUDIT.md (App Store §1.2 — User-Generated Content) requires UGC apps to
// ship a reporting mechanism; rate-limited via the `report` bucket.
//
// Migration also fixed a pre-existing bug: the legacy validator only
// accepted ['review', 'user', 'list'] despite the type signature including
// 'post' | 'post_comment', so post-side reports silently 400-ed. The new
// route accepts all five content types.
