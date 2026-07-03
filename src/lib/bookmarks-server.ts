/**
 * Bookmark helpers — Phase A PR #15.
 *
 * Users save feed items (activities + posts) for the "saved" archive.
 * Doc id is deterministic — `{itemType}_{itemId}` — so save is idempotent
 * and unsave is a known-path delete (no extra read). The cache provider
 * (`UserBookmarksCacheProvider`) loads the key set once on mount and
 * checks bookmark state in O(1).
 *
 * The hydrated archive (the actual saved activities/posts) lives behind
 * `getSavedFeed`, which paginates the bookmark keys + batch-loads the
 * source docs. Dangling bookmarks (source deleted) are silently skipped —
 * the bookmark doc stays but doesn't render.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/firebase/admin';
import { activityFromDoc } from '@/lib/activities-server';
import { postFromDoc, canViewPost, serializePostForViewer, type FeedItem } from '@/lib/posts-server';
import type { Activity, Post } from '@/lib/types';

// ─── Typed errors ─────────────────────────────────────────────────────────

export class BookmarkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkValidationError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────

export const SAVEABLE_TYPES = ['activity', 'post'] as const;
export type SaveableType = (typeof SAVEABLE_TYPES)[number];

const BOOKMARKS_MAX = 1000; // matches the legacy ceiling
const SAVED_FEED_DEFAULT = 20;
const SAVED_FEED_MAX = 50;

function isSaveable(t: unknown): t is SaveableType {
  return typeof t === 'string' && (SAVEABLE_TYPES as readonly string[]).includes(t);
}

// ─── saveItem / unsaveItem ────────────────────────────────────────────────

export async function saveItem(
  callerUid: string,
  itemType: string,
  itemId: string,
): Promise<void> {
  if (!isSaveable(itemType) || !itemId) {
    throw new BookmarkValidationError('Invalid item.');
  }
  const db = getDb();
  await db
    .collection('users').doc(callerUid)
    .collection('bookmarks').doc(`${itemType}_${itemId}`)
    .set({ itemType, itemId, savedAt: FieldValue.serverTimestamp() });
}

export async function unsaveItem(
  callerUid: string,
  itemType: string,
  itemId: string,
): Promise<void> {
  if (!isSaveable(itemType) || !itemId) {
    throw new BookmarkValidationError('Invalid item.');
  }
  const db = getDb();
  await db
    .collection('users').doc(callerUid)
    .collection('bookmarks').doc(`${itemType}_${itemId}`)
    .delete();
}

// ─── getMyBookmarks — cache hydrator ──────────────────────────────────────

/**
 * Every bookmark doc id (`{type}_{id}`) for the viewer, newest-saved first.
 * Capped at 1000 — beyond that, the cache stops being useful and the user
 * should be using getSavedFeed pagination instead.
 */
export async function getMyBookmarks(
  callerUid: string,
): Promise<{ keys: string[] }> {
  const db = getDb();
  const snap = await db
    .collection('users').doc(callerUid)
    .collection('bookmarks')
    .orderBy('savedAt', 'desc')
    .limit(BOOKMARKS_MAX)
    .get();
  return { keys: snap.docs.map((d) => d.id) };
}

// ─── getSavedFeed — paginated, hydrated ───────────────────────────────────

/**
 * Cursor-paginated FeedItem[] reading bookmarks newest-saved first and
 * batch-loading each source doc. Dangling bookmarks (deleted source) are
 * silently skipped — the bookmark doc stays so removing it requires an
 * explicit unsave; the displayed list just hides them.
 */
export async function getSavedFeed(
  callerUid: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string }> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? SAVED_FEED_DEFAULT),
    SAVED_FEED_MAX,
  );
  const db = getDb();
  const bookmarksCol = db.collection('users').doc(callerUid).collection('bookmarks');

  let q = bookmarksCol.orderBy('savedAt', 'desc').limit(limit + 1);
  if (opts.cursor) {
    const curDoc = await bookmarksCol.doc(opts.cursor).get();
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
      // Respect F04 audience: a post whose visibility changed (or was always
      // restricted) is hidden from a saver who's no longer in its audience.
      if (p && canViewPost(p, callerUid)) {
        items.push({ kind: 'post', post: serializePostForViewer(p, callerUid) });
      }
    }
  }
  return {
    items,
    hasMore,
    nextCursor: hasMore ? docs[docs.length - 1]?.id : undefined,
  };
}
