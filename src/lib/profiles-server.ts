/**
 * Profile + onboarding helpers — Phase A PR #18.
 *
 * Covers:
 *   - `getUserByUsername`: public-profile lookup by `@handle`. Returns the
 *     same UserProfile shape as the rest of the API; legacy docs without
 *     `usernameLower` get migrated on the fly.
 *   - `checkUsernameAvailability`: free-text availability check.
 *   - `createUserProfileWithUsername`: the post-signup onboarding step
 *     where the user picks a handle. Race-protected (re-checks
 *     availability inside the same call). Creates a default list.
 *   - `ensureUserProfile`: idempotent — used when an existing user signs
 *     in and may be missing social fields or a default list.
 *
 * AUDIT 1.9: `email` always lands in `/users_private/{uid}` (server-only
 * read); the public `/users/{uid}` doc never carries it.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import type { UserProfile } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class UserNotFoundError extends Error {
  constructor(message = 'User not found.') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

export class UsernameFormatError extends Error {
  constructor(message = 'Invalid username format.') {
    super(message);
    this.name = 'UsernameFormatError';
  }
}

export class UsernameTakenError extends Error {
  constructor(message = 'Username is already taken.') {
    super(message);
    this.name = 'UsernameTakenError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// ─── Internal: generateUniqueUsername ─────────────────────────────────────

async function generateUniqueUsername(
  db: FirebaseFirestore.Firestore,
  email: string,
  displayName: string | null,
): Promise<string> {
  let baseUsername = displayName?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
                     email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (baseUsername.length < 3) baseUsername = baseUsername + 'user';

  let username = baseUsername;
  let counter = 1;
  while (true) {
    const existing = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();
    if (existing.empty) return username;
    username = `${baseUsername}${counter}`;
    counter++;
    if (counter > 1000) return `${baseUsername}${Date.now()}`;
  }
}

// ─── Internal: createProfileAndDefaultList ────────────────────────────────

async function createProfileAndDefaultList(
  userId: string,
  email: string,
  displayName: string | null,
): Promise<{ defaultListId: string; username: string }> {
  const db = getDb();
  const username = await generateUniqueUsername(db, email, displayName);

  const userRef = db.collection('users').doc(userId);
  // AUDIT.md 1.9: /users/{uid} is publicly readable; email lives in
  // /users_private (owner-only via firestore.rules).
  await userRef.set({
    uid: userId,
    displayName,
    displayNameLower: displayName?.toLowerCase() || null,
    photoURL: null,
    username,
    usernameLower: username.toLowerCase(),
    followersCount: 0,
    followingCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('users_private').doc(userId).set({
    uid: userId,
    email,
    emailLower: email.toLowerCase(),
  });

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
  return { defaultListId: listRef.id, username };
}

// ─── getUserByUsername — public profile lookup ────────────────────────────

export async function getUserByUsername(username: string): Promise<{ user: UserProfile }> {
  const db = getDb();
  const normalized = username.toLowerCase().trim();

  let usersSnapshot = await db.collection('users')
    .where('usernameLower', '==', normalized)
    .limit(1)
    .get();

  // Fallback: legacy docs without usernameLower.
  if (usersSnapshot.empty) {
    usersSnapshot = await db.collection('users')
      .where('username', '==', normalized)
      .limit(1)
      .get();
  }
  if (usersSnapshot.empty) throw new UserNotFoundError();

  const doc = usersSnapshot.docs[0];
  const data = doc.data();

  // Read-time migration: legacy doc → write the normalized fields.
  if (!data.usernameLower && data.username) {
    await db.collection('users').doc(doc.id).update({
      usernameLower: data.username.toLowerCase(),
      emailLower: (data.email || '').toLowerCase(),
      displayNameLower: (data.displayName || '').toLowerCase() || null,
    });
  }

  return {
    user: {
      uid: data.uid || doc.id,
      email: data.email || '', // 1.9: stays empty on the public response
      displayName: data.displayName || null,
      photoURL: data.photoURL || null,
      username: data.username || null,
      bio: data.bio || null,
      favoriteMovies: data.favoriteMovies || [],
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      followersCount: data.followersCount || 0,
      followingCount: data.followingCount || 0,
    } as UserProfile,
  };
}

// ─── checkUsernameAvailability ────────────────────────────────────────────

export async function checkUsernameAvailability(
  username: string,
): Promise<{ available: boolean; suggestions: string[] }> {
  const normalized = username.toLowerCase().trim();
  if (!USERNAME_RE.test(normalized)) {
    throw new UsernameFormatError();
  }
  const db = getDb();
  const snapshot = await db.collection('users')
    .where('usernameLower', '==', normalized)
    .limit(1)
    .get();

  const available = snapshot.empty;
  const suggestions = available ? [] : [
    `${normalized}${Math.floor(Math.random() * 100)}`,
    `${normalized}_films`,
    `${normalized}${new Date().getFullYear() % 100}`,
  ];
  return { available, suggestions };
}

// ─── createUserProfileWithUsername — onboarding finalize ─────────────────

export async function createUserProfileWithUsername(
  callerUid: string,
  email: string,
  username: string,
  displayName: string | null,
): Promise<{ defaultListId: string | null }> {
  const normalized = username.toLowerCase().trim();
  if (!USERNAME_RE.test(normalized)) {
    throw new UsernameFormatError();
  }

  const db = getDb();
  // Race-protection: re-check after the client already saw "available".
  const existingSnapshot = await db.collection('users')
    .where('usernameLower', '==', normalized)
    .limit(1)
    .get();
  if (!existingSnapshot.empty) {
    throw new UsernameTakenError();
  }

  const userRef = db.collection('users').doc(callerUid);
  const existingUser = await userRef.get();

  if (existingUser.exists) {
    await userRef.update({
      username: normalized,
      usernameLower: normalized,
      displayName,
      displayNameLower: displayName?.toLowerCase() || null,
      onboardingComplete: false,
    });
  } else {
    await userRef.set({
      uid: callerUid,
      displayName,
      displayNameLower: displayName?.toLowerCase() || null,
      photoURL: null,
      username: normalized,
      usernameLower: normalized,
      followersCount: 0,
      followingCount: 0,
      onboardingComplete: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    await db.collection('users_private').doc(callerUid).set({
      uid: callerUid,
      email,
      emailLower: email.toLowerCase(),
    });
  }

  // Default list — create if missing, reuse if present.
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
      ownerId: callerUid,
      collaboratorIds: [],
      movieCount: 0,
    });
    defaultListId = listRef.id;
  } else {
    defaultListId = listsSnapshot.docs[0].id;
  }
  return { defaultListId };
}

// ─── ensureUserProfile — idempotent on existing-user sign-in ─────────────

/**
 * Ensures a user has a profile + default list. Used on every authenticated
 * boot. Migrates legacy docs missing social fields (`username`,
 * `usernameLower`, `followersCount`, etc.) on read.
 */
export async function ensureUserProfile(
  callerUid: string,
  email: string,
  displayName: string | null,
): Promise<{ defaultListId: string }> {
  const db = getDb();
  const userRef = db.collection('users').doc(callerUid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    const created = await createProfileAndDefaultList(callerUid, email, displayName);
    return { defaultListId: created.defaultListId };
  }

  const userData = userDoc.data();
  const needsMigration = userData && (
    userData.username === undefined ||
    userData.usernameLower === undefined ||
    userData.followersCount === undefined
  );
  if (needsMigration) {
    const username = userData?.username || await generateUniqueUsername(db, email, displayName);
    await userRef.update({
      username,
      usernameLower: username.toLowerCase(),
      displayNameLower: (userData?.displayName || displayName)?.toLowerCase() || null,
      followersCount: userData?.followersCount ?? 0,
      followingCount: userData?.followingCount ?? 0,
    });
    await db.collection('users_private').doc(callerUid).set({
      uid: callerUid,
      email: userData?.email || email,
      emailLower: (userData?.email || email).toLowerCase(),
    }, { merge: true });
  }

  const listsSnapshot = await userRef.collection('lists').limit(1).get();
  if (listsSnapshot.empty) {
    const listRef = userRef.collection('lists').doc();
    await listRef.set({
      id: listRef.id,
      name: 'My Watchlist',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      isDefault: true,
      isPublic: true,
      ownerId: callerUid,
    });
    return { defaultListId: listRef.id };
  }

  const defaultListQuery = await userRef
    .collection('lists').where('isDefault', '==', true).limit(1).get();
  if (!defaultListQuery.empty) {
    return { defaultListId: defaultListQuery.docs[0].id };
  }
  return { defaultListId: listsSnapshot.docs[0].id };
}
