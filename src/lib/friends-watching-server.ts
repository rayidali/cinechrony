/**
 * "Friends are watching" — aggregated hero card helper (Phase A PR #15).
 *
 * Collapses recent followed-user activity by film: a title touched by 2+
 * distinct followed users becomes one card so the feed doesn't show the
 * same movie five times in a row. Returns up to 4 cards, sorted by friend
 * count desc.
 *
 * Auth is caller-only — the viewer's "following" set is the input. The
 * legacy action took an idToken arg; the route layer derives identity
 * from the Bearer token only.
 */

import { getDb } from '@/firebase/admin';
import { createTtlCache, cached } from '@/lib/server-cache';
import { getFollowingIds } from '@/lib/follows-server';
import { getHomeSnapshot, type SnapshotActivity } from '@/lib/home-snapshot-server';

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

// Per-caller cache — collapses the recent-activity scan + per-card enrichment
// across repeated home loads. 5 min staleness is fine for a "watching" rail.
const friendsWatchingCache = createTtlCache<{ cards: FriendsWatchingCard[] }>({ ttlMs: 300_000 });

export async function getFriendsWatching(
  callerUid: string,
): Promise<{ cards: FriendsWatchingCard[] }> {
  return cached(friendsWatchingCache, callerUid, async () => {
  // Fast path: the GLOBAL snapshot's recent-activity feed, filtered to the
  // caller's follows in memory — no per-user 200-doc scan. Falls back to the
  // live scan if the snapshot isn't built yet.
  const [snapshot, followingIds] = await Promise.all([
    getHomeSnapshot(),
    getFollowingIds(callerUid, 500),
  ]);
  const followSet = new Set(followingIds);
  if (followSet.size === 0) return { cards: [] };

  if (snapshot) {
    return { cards: groupFriendsWatching(snapshot.recent.filter((a) => followSet.has(a.uid))) };
  }

  // ── live-scan fallback (snapshot missing) ──
  const db = getDb();
  const recent = await db
    .collection('activities')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  const acts: SnapshotActivity[] = recent.docs
    .map((doc) => {
      const d = doc.data();
      return {
        uid: d.userId,
        username: d.username ?? null,
        displayName: d.displayName ?? null,
        photoURL: d.photoURL ?? null,
        type: d.type ?? '',
        tmdbId: d.tmdbId,
        movieTitle: d.movieTitle ?? 'a film',
        moviePosterUrl: d.moviePosterUrl ?? null,
        movieYear: d.movieYear ?? '',
        mediaType: d.mediaType === 'tv' ? 'tv' : 'movie',
        rating: typeof d.rating === 'number' ? d.rating : null,
        createdAt: 0,
      } as SnapshotActivity;
    })
    .filter((a) => a.uid && a.tmdbId && followSet.has(a.uid));
  return { cards: groupFriendsWatching(acts) };
  });
}

// "your circle is WATCHING" — only films a friend actually saw count. An
// `added` activity just means they put it on a watchlist (want-to-watch), which
// this card was wrongly surfacing as if they'd watched it.
const SEEN_TYPES = new Set(['watched', 'rated', 'reviewed']);

/** Collapse recent followed-user activity by film (≥2 distinct friends), newest
 *  identity wins, top 4 by friend count. Shared by the snapshot + live paths. */
function groupFriendsWatching(acts: SnapshotActivity[]): FriendsWatchingCard[] {
  const groups = new Map<number, SnapshotActivity[]>();
  for (const a of acts) {
    if (!a.tmdbId) continue;
    if (!SEEN_TYPES.has(a.type)) continue; // exclude want-to-watch ('added')
    if (!groups.has(a.tmdbId)) groups.set(a.tmdbId, []);
    groups.get(a.tmdbId)!.push(a);
  }
  const cards: FriendsWatchingCard[] = [];
  for (const [tmdbId, group] of groups) {
    const friendUids = [...new Set(group.map((a) => a.uid))];
    if (friendUids.length < 2) continue;
    const friends = friendUids.map((uid) => {
      const a = group.find((x) => x.uid === uid)!;
      return { uid, username: a.username, displayName: a.displayName, photoURL: a.photoURL };
    });
    const ratings = group.map((a) => a.rating).filter((r): r is number => typeof r === 'number');
    const first = group[0];
    cards.push({
      tmdbId,
      movieTitle: first.movieTitle,
      moviePosterUrl: first.moviePosterUrl,
      movieYear: first.movieYear,
      mediaType: first.mediaType,
      friends,
      avgRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
      reviewCount: group.filter((a) => a.type === 'reviewed').length,
    });
  }
  cards.sort((a, b) => b.friends.length - a.friends.length);
  return cards.slice(0, 4);
}
