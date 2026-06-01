/**
 * Search-server helpers — Phase A PR #14.
 *
 * `searchUsers` extracted from `src/app/actions.ts`. The post-AUDIT-2.8
 * implementation (two parallel single-field prefix-range queries — ~40
 * reads/keystroke max instead of full collection scan) is preserved
 * verbatim. The route layer adds caller identity via Bearer token so the
 * "exclude self + block-filter" logic now keys off the token rather than
 * a trustworthy-only-by-convention `currentUserId` arg.
 *
 * Legacy users without `usernameLower` / `displayNameLower` won't appear
 * in search until `backfillUserSearchFields` is run — same pre-launch
 * operational task as the email-privacy backfill.
 */

import { getDb } from '@/firebase/admin';
import { getBlockSet } from '@/lib/blocks-server';
import type { UserProfile } from '@/lib/types';

const PER_FIELD_LIMIT = 20;
const FINAL_LIMIT = 10;
const MIN_QUERY_LEN = 2;

/**
 * Find users by username or displayName prefix (case-insensitive).
 * Excludes the viewer (if provided) and anyone in the block-union.
 * Email is never returned (lives in `/users_private`).
 */
export async function searchUsersForViewer(
  query: string,
  viewerUid: string | null,
): Promise<{ users: UserProfile[] }> {
  if (!query || query.trim().length < MIN_QUERY_LEN) return { users: [] };

  const db = getDb();
  const q = query.toLowerCase().trim();
  // Classic Firestore prefix-range pattern — [q, q + '') matches every
  // string starting with q ( is a high-codepoint sentinel).
  const upper = q + '';

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
    if (docUid === viewerUid) return;
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
  const blockSet = viewerUid ? await getBlockSet(db, viewerUid) : new Set<string>();

  // Rank: exact @handle match > @handle prefix > alphabetical.
  const users = Array.from(usersMap.values())
    .filter((u) => !blockSet.has(u.uid) && u.uid !== viewerUid)
    .sort((a, b) => {
      const au = (a.username || '').toLowerCase();
      const bu = (b.username || '').toLowerCase();
      if (au === q && bu !== q) return -1;
      if (bu === q && au !== q) return 1;
      if (au.startsWith(q) && !bu.startsWith(q)) return -1;
      if (bu.startsWith(q) && !au.startsWith(q)) return 1;
      return au.localeCompare(bu);
    })
    .slice(0, FINAL_LIMIT);

  return { users };
}
