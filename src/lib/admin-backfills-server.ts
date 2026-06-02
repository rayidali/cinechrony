/**
 * Admin backfill helpers — Phase A PR #16.
 *
 * One-shot data-migration jobs. Each is idempotent (safe to re-run; skips
 * already-migrated docs) and reports stats. **Auth is handled by the
 * route layer (`adminRoute`)** — these functions trust that the caller
 * has already been authorized via `x-admin-token`.
 *
 * AUDIT.md 1.8 closure: the legacy `"run-backfill-now"` sentinel string
 * is gone end-to-end. The legacy actions did their own `ADMIN_SECRET`
 * recheck; that's no longer needed — the route gate is the single source
 * of truth.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';

// ─── Result types ─────────────────────────────────────────────────────────

export type EmailPrivacyStats = {
  migrated: number;
  skipped: number;
};

export type UserSearchStats = {
  migratedCount: number;
  skippedCount: number;
};

export type MovieUserDataStats = {
  usersProcessed: number;
  listsProcessed: number;
  moviesProcessed: number;
  moviesUpdated: number;
  notesUpdated: number;
  errors: string[];
};

export type ReviewsThreadingStats = {
  updated: number;
  skipped: number;
  total: number;
};

// ─── backfillEmailPrivacy (AUDIT 1.9 split) ───────────────────────────────

/**
 * Move `email` + `emailLower` from `/users/{uid}` (public) to
 * `/users_private/{uid}` (owner-only). One-shot for legacy docs;
 * idempotent (already-migrated docs have no `email` on /users and are
 * skipped).
 */
export async function backfillEmailPrivacy(): Promise<EmailPrivacyStats> {
  const db = getDb();
  const usersSnapshot = await db.collection('users').get();
  let migrated = 0;
  let skipped = 0;

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    const hasEmail = data.email !== undefined || data.emailLower !== undefined;
    if (!hasEmail) {
      skipped++;
      continue;
    }
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

  return { migrated, skipped };
}

// ─── backfillUserSearchFields (AUDIT 2.8 prerequisite) ────────────────────

/**
 * Populate `usernameLower` / `emailLower` / `displayNameLower` on legacy
 * user docs so the prefix-range search picks them up. Idempotent. Batches
 * in groups of 400 to stay under Firestore's 500-op write limit.
 */
export async function backfillUserSearchFields(): Promise<UserSearchStats> {
  const db = getDb();
  const usersSnapshot = await db.collection('users').get();
  let migratedCount = 0;
  let skippedCount = 0;

  let batch = db.batch();
  let batchCount = 0;
  const MAX_BATCH_SIZE = 400;

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    if (data.usernameLower) {
      skippedCount++;
      continue;
    }
    if (!data.username) {
      skippedCount++;
      continue;
    }
    batch.update(doc.ref, {
      usernameLower: data.username.toLowerCase(),
      emailLower: (data.email || '').toLowerCase(),
      displayNameLower: data.displayName?.toLowerCase() || null,
    });
    batchCount++;
    migratedCount++;

    if (batchCount >= MAX_BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  return { migratedCount, skippedCount };
}

// ─── backfillMovieUserData (denormalization for N+1 elimination) ──────────

/**
 * Populate denormalized `addedByUsername` / `addedByDisplayName` /
 * `addedByPhotoURL` + `noteAuthors` on every existing movie doc. Caches
 * user lookups per-run. Idempotent (skips movies that already have the
 * denormalized fields).
 */
export async function backfillMovieUserData(): Promise<MovieUserDataStats> {
  const db = getDb();
  const stats: MovieUserDataStats = {
    usersProcessed: 0,
    listsProcessed: 0,
    moviesProcessed: 0,
    moviesUpdated: 0,
    notesUpdated: 0,
    errors: [],
  };

  const userProfileCache = new Map<
    string,
    { username: string | null; displayName: string | null; photoURL: string | null }
  >();
  async function getUserData(uid: string) {
    if (userProfileCache.has(uid)) return userProfileCache.get(uid)!;
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

  const usersSnapshot = await db.collection('users').get();
  for (const userDoc of usersSnapshot.docs) {
    stats.usersProcessed++;
    const userId = userDoc.id;
    try {
      const listsSnapshot = await db
        .collection('users').doc(userId).collection('lists').get();

      for (const listDoc of listsSnapshot.docs) {
        stats.listsProcessed++;
        try {
          const moviesSnapshot = await db
            .collection('users').doc(userId)
            .collection('lists').doc(listDoc.id)
            .collection('movies').get();

          for (const movieDoc of moviesSnapshot.docs) {
            stats.moviesProcessed++;
            const movieData = movieDoc.data();
            const updates: Record<string, unknown> = {};
            let needsUpdate = false;

            if (movieData.addedBy && !movieData.addedByUsername) {
              const u = await getUserData(movieData.addedBy);
              updates.addedByUsername = u.username;
              updates.addedByDisplayName = u.displayName;
              updates.addedByPhotoURL = u.photoURL;
              needsUpdate = true;
            }

            if (movieData.notes && Object.keys(movieData.notes).length > 0) {
              const noteAuthors: Record<
                string,
                { username: string | null; displayName: string | null; photoURL: string | null }
              > = movieData.noteAuthors || {};

              for (const noteAuthorUid of Object.keys(movieData.notes)) {
                if (!noteAuthors[noteAuthorUid]) {
                  noteAuthors[noteAuthorUid] = await getUserData(noteAuthorUid);
                  stats.notesUpdated++;
                  needsUpdate = true;
                }
              }
              if (needsUpdate && Object.keys(noteAuthors).length > 0) {
                updates.noteAuthors = noteAuthors;
              }
            }

            if (needsUpdate) {
              await movieDoc.ref.update(updates);
              stats.moviesUpdated++;
            }
          }
        } catch (listErr) {
          stats.errors.push(`List ${listDoc.id}: ${String(listErr)}`);
        }
      }
    } catch (userErr) {
      stats.errors.push(`User ${userId}: ${String(userErr)}`);
    }
  }
  return stats;
}

// ─── backfillReviewsThreading ─────────────────────────────────────────────

/**
 * Add `parentId: null` and `replyCount` to legacy review docs so the
 * threading queries (`where('parentId', '==', null)` for top-level) work.
 * Idempotent — skips docs that already have `parentId`.
 */
export async function backfillReviewsThreading(): Promise<ReviewsThreadingStats> {
  const db = getDb();
  const stats: ReviewsThreadingStats = { updated: 0, skipped: 0, total: 0 };

  const reviewsSnapshot = await db.collection('reviews').get();
  stats.total = reviewsSnapshot.size;

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of reviewsSnapshot.docs) {
    const data = doc.data();
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
    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  return stats;
}
