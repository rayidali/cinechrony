/**
 * Weekly leaderboard — "top watchers" (Phase 0.7 / v3 home rail, `ios-home.jsx`).
 *
 * GLOBAL ranking: the most active watchers across the WHOLE app in the window,
 * by how many distinct films they logged. "Logged" = a `watched` / `rated` /
 * `reviewed` activity (the three signals a film was actually seen). Real
 * aggregate — no fabricated rows; an empty result hides the rail. (2026-07: was
 * incorrectly scoped to the caller's follow-graph — everyone saw only their
 * friends, not the app-wide board. Global is the intended behavior; it also
 * drops the per-request `getFollowingIds` read.)
 *
 * The only per-caller input is BLOCK removal — a blocked user never appears in
 * your board. Everything else is identical for every viewer, so the expensive
 * scan is shared (via the global home snapshot).
 */

import { getDb } from '@/firebase/admin';
import { getMyBlockSet } from '@/lib/blocks-server';
import { createTtlCache, cached } from '@/lib/server-cache';
import { getHomeSnapshot, type SnapshotWatcher } from '@/lib/home-snapshot-server';

export type LeaderboardEntry = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  films: number;
  rank: number;
  /** Rank change vs the previous equal-length period (+up / −down / 0 same).
   *  `null` = not comparable (all-time, the fallback path, or a new entrant). */
  movement?: number | null;
  /** Appeared this period (the prior period had data; this user wasn't ranked). */
  isNew?: boolean;
};

const LOG_TYPES = new Set(['watched', 'rated', 'reviewed']);

// Per-caller cache — the underlying 800-doc /activities scan is the single most
// read-expensive query on the home rail. 2 min staleness is invisible for a
// weekly ranking and collapses repeated home loads to one scan per window.
const leaderboardCache = createTtlCache<{ entries: LeaderboardEntry[] }>({ ttlMs: 600_000 });

export async function getWeeklyLeaderboard(
  callerUid: string,
  windowDays = 7,
  limit = 12,
  opts: { fallbackToAllTime?: boolean } = {},
): Promise<{ entries: LeaderboardEntry[] }> {
  const fallbackToAllTime = opts.fallbackToAllTime === true;
  const key = `${callerUid}:${windowDays}:${limit}:${fallbackToAllTime ? 'f' : ''}`;
  return cached(leaderboardCache, key, async () => {
    // The home rail (7-day window) is served from the GLOBAL snapshot — one
    // shared scan instead of a per-user 800-doc scan. Month/all-time (the
    // infrequent F16 "view all") + a missing snapshot fall through to the live
    // scan below.
    if (windowDays === 7) {
      const snapEntries = await leaderboardFromSnapshot(callerUid, limit, fallbackToAllTime);
      if (snapEntries) return { entries: snapEntries };
    }
    const db = getDb();

    // Only per-caller input: the block set (a blocked user never shows on your
    // board). Everyone else is ranked globally.
    const blocked = await getMyBlockSet(callerUid).catch(() => new Set<string>());

    // ONE index-free scan of the most recent activity (no date filter in the
    // query, so the same docs serve any window + the all-time fallback below in
    // a single read). `createdAt desc` is an automatic single-field index.
    const snap = await db
      .collection('activities')
      .orderBy('createdAt', 'desc')
      .limit(800)
      .get();

    type Acc = {
      username: string | null;
      displayName: string | null;
      photoURL: string | null;
      films: Set<number>;
    };

    const rank = (docs: FirebaseFirestore.QueryDocumentSnapshot[]): LeaderboardEntry[] => {
      const perUser = new Map<string, Acc>();
      for (const doc of docs) {
        const a = doc.data() as {
          userId?: string;
          type?: string;
          tmdbId?: number;
          username?: string | null;
          displayName?: string | null;
          photoURL?: string | null;
        };
        if (!a.userId || blocked.has(a.userId)) continue;
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
        // Docs are createdAt desc, so the first-seen identity is the newest.
        perUser.set(a.userId, acc);
      }
      return [...perUser.entries()]
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
    };

    const tsOf = (doc: FirebaseFirestore.QueryDocumentSnapshot): number =>
      (doc.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;

    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const windowed = snap.docs.filter((doc) => tsOf(doc) >= cutoff);

    let entries = rank(windowed);
    let usedFallback = false;
    // Young app / sparse week: rather than render an empty rail, fall back to the
    // most-active loggers over all recent activity (opt-in, home rail only).
    if (entries.length === 0 && fallbackToAllTime) {
      entries = rank(snap.docs);
      usedFallback = true;
    }

    // Weekly/monthly movement vs the previous equal-length period — computed
    // in-memory from the SAME scan (no extra reads). Skipped for all-time and
    // the fallback path (where a window comparison is meaningless).
    const isAllTime = windowDays >= 3650;
    if (!isAllTime && !usedFallback) {
      const priorStart = Date.now() - 2 * windowDays * 24 * 60 * 60 * 1000;
      const priorDocs = snap.docs.filter((doc) => {
        const ts = tsOf(doc);
        return ts >= priorStart && ts < cutoff;
      });
      const prior = rank(priorDocs);
      const priorRankByUid = new Map(prior.map((e) => [e.uid, e.rank]));
      const priorHadData = prior.length > 0;
      entries = entries.map((e) =>
        priorRankByUid.has(e.uid)
          ? { ...e, movement: (priorRankByUid.get(e.uid) as number) - e.rank, isNew: false }
          : { ...e, movement: null, isNew: priorHadData },
      );
    }

    return { entries };
  });
}

/**
 * Week leaderboard from the global snapshot — the home-rail fast path. Returns
 * null if there's no snapshot yet (caller falls back to the live scan), so the
 * rail never goes empty during the first build / a snapshot outage.
 */
async function leaderboardFromSnapshot(
  callerUid: string,
  limit: number,
  fallbackToAllTime: boolean,
): Promise<LeaderboardEntry[] | null> {
  const [snapshot, blocked] = await Promise.all([
    getHomeSnapshot(),
    getMyBlockSet(callerUid).catch(() => new Set<string>()),
  ]);
  if (!snapshot) return null;

  // Global board: rank every watcher in the snapshot, minus the caller's blocks.
  const rankBy = (pick: (w: SnapshotWatcher) => number): LeaderboardEntry[] =>
    snapshot.watchers
      .filter((w) => !blocked.has(w.uid) && pick(w) > 0)
      .map((w) => ({
        uid: w.uid,
        username: w.username,
        displayName: w.displayName,
        photoURL: w.photoURL,
        films: pick(w),
      }))
      .sort((a, b) => b.films - a.films || (a.username ?? '').localeCompare(b.username ?? ''))
      .slice(0, limit)
      .map((e, i) => ({ ...e, rank: i + 1 }));

  let entries = rankBy((w) => w.filmsCurrent);
  let usedFallback = false;
  if (entries.length === 0 && fallbackToAllTime) {
    entries = rankBy((w) => w.filmsAll);
    usedFallback = true;
  }

  if (!usedFallback) {
    const prior = rankBy((w) => w.filmsPrior);
    const priorRankByUid = new Map(prior.map((e) => [e.uid, e.rank]));
    const priorHadData = prior.length > 0;
    entries = entries.map((e) =>
      priorRankByUid.has(e.uid)
        ? { ...e, movement: (priorRankByUid.get(e.uid) as number) - e.rank, isNew: false }
        : { ...e, movement: null, isNew: priorHadData },
    );
  }

  return entries;
}
