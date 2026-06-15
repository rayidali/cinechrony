/**
 * Weekly leaderboard — "top watchers" (Phase 0.7 / v3 home rail, `ios-home.jsx`).
 *
 * Ranks the people the caller follows (plus the caller) by how many distinct
 * films they logged in the window. "Logged" = a `watched` / `rated` / `reviewed`
 * activity (the three signals that a film was actually seen). Real aggregate —
 * no fabricated rows; an empty result hides the rail.
 *
 * Implementation: one window-scoped scan of `/activities` (ordered by createdAt,
 * capped) grouped in memory to the follow set. Good to a few hundred recent
 * events; a denormalized weekly counter is the scale follow-up (noted in
 * PHASE-0.7-REDESIGN.md 0.7.5).
 */

import { getDb } from '@/firebase/admin';
import { getFollowing } from '@/lib/follows-server';
import { getMyBlockSet } from '@/lib/blocks-server';
import { createTtlCache, cached } from '@/lib/server-cache';

export type LeaderboardEntry = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  films: number;
  rank: number;
};

const LOG_TYPES = new Set(['watched', 'rated', 'reviewed']);

// Per-caller cache — the underlying 800-doc /activities scan is the single most
// read-expensive query on the home rail. 2 min staleness is invisible for a
// weekly ranking and collapses repeated home loads to one scan per window.
const leaderboardCache = createTtlCache<{ entries: LeaderboardEntry[] }>({ ttlMs: 120_000 });

export async function getWeeklyLeaderboard(
  callerUid: string,
  windowDays = 7,
  limit = 12,
): Promise<{ entries: LeaderboardEntry[] }> {
  return cached(leaderboardCache, `${callerUid}:${windowDays}:${limit}`, async () => {
  const db = getDb();

  const [following, blocked] = await Promise.all([
    getFollowing(callerUid, 200),
    getMyBlockSet(callerUid).catch(() => new Set<string>()),
  ]);

  // The candidate set = people you follow (+ you), minus anyone blocked.
  const include = new Set<string>([callerUid]);
  for (const u of following) include.add(u.uid);
  for (const b of blocked) include.delete(b);
  if (include.size === 0) return { entries: [] };

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection('activities')
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .limit(800)
    .get();

  type Acc = {
    username: string | null;
    displayName: string | null;
    photoURL: string | null;
    films: Set<number>;
  };
  const perUser = new Map<string, Acc>();

  for (const doc of snap.docs) {
    const a = doc.data() as {
      userId?: string;
      type?: string;
      tmdbId?: number;
      username?: string | null;
      displayName?: string | null;
      photoURL?: string | null;
    };
    if (!a.userId || !include.has(a.userId)) continue;
    if (!a.type || !LOG_TYPES.has(a.type)) continue;
    if (!a.tmdbId) continue;
    const acc =
      perUser.get(a.userId) ??
      {
        username: a.username ?? null,
        displayName: a.displayName ?? null,
        photoURL: a.photoURL ?? null,
        films: new Set<number>(),
      };
    acc.films.add(a.tmdbId);
    // Prefer the most recent denormalized identity (docs are createdAt desc,
    // so the first seen is already newest — keep it).
    perUser.set(a.userId, acc);
  }

  const entries = [...perUser.entries()]
    .map(([uid, acc]) => ({
      uid,
      username: acc.username,
      displayName: acc.displayName,
      photoURL: acc.photoURL,
      films: acc.films.size,
    }))
    .filter((e) => e.films > 0)
    .sort((a, b) => b.films - a.films || (a.username ?? '').localeCompare(b.username ?? ''))
    .slice(0, limit)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  return { entries };
  });
}
