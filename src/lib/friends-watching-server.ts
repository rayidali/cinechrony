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
  const db = getDb();

  const followingSnap = await db
    .collection('users').doc(callerUid).collection('following').get();
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
  });
}
