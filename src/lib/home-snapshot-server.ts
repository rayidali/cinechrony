/**
 * Home-rail snapshot (Phase 0.7 — free-tier scale fix).
 *
 * The leaderboard ("top watchers") and friends-watching rails each scanned the
 * recent `/activities` (up to 800 / 200 docs = that many READS) and were keyed
 * PER USER — so cost grew with both activity volume AND user count, the thing
 * that would blow the 50k-reads/day free-tier cap at ~500 users.
 *
 * This builds that scan ONCE into a single global doc (`/snapshots/home`) that
 * every user reads in ~1 read (server-cached per warm instance) and filters to
 * their own follow-graph in memory. Rebuild is lazy + stale-while-revalidate +
 * transaction-claimed (one instance rebuilds per window; the rest serve the
 * existing snapshot) — no Vercel cron dependency (free Hobby caps crons at
 * daily). Cost becomes O(1) in users: one ~800-read scan per refresh window.
 *
 * Leaderboard/friends-watching fall back to their live scans if the snapshot is
 * missing, so the rails can never regress to empty.
 */

import { getDb } from '@/firebase/admin';
import { createTtlCache, cachingDisabled } from '@/lib/server-cache';

const SNAPSHOT_PATH = 'snapshots/home';
/** How long a snapshot is served before a rebuild is triggered. Weekly board +
 *  "watching lately" both tolerate ~an hour; this bounds the rebuild scan to
 *  ≤24/day so the cron-replacement cost stays modest at scale. */
const STALE_MS = 60 * 60 * 1000;
/** A rebuild claim is held this long so a slow scan doesn't get double-run. */
const CLAIM_MS = 5 * 60 * 1000;
const ACTIVITY_SCAN_LIMIT = 800;
const RECENT_LIMIT = 200;
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// "Seen" signals — what counts toward the leaderboard film tally.
const LOG_TYPES = new Set(['watched', 'rated', 'reviewed']);

export type SnapshotWatcher = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  filmsCurrent: number; // distinct films in the last WINDOW_DAYS
  filmsPrior: number;   // distinct films in the prior equal window (for movement)
  filmsAll: number;     // distinct films across the whole scan (all-time fallback)
};

export type SnapshotActivity = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  type: string;
  tmdbId: number;
  movieTitle: string;
  moviePosterUrl: string | null;
  movieYear: string;
  mediaType: 'movie' | 'tv';
  rating: number | null;
  createdAt: number; // ms epoch
};

export type HomeSnapshot = {
  builtAt: number; // ms epoch
  windowDays: number;
  watchers: SnapshotWatcher[];
  recent: SnapshotActivity[];
};

// Per-instance dedup of the snapshot-doc read (so repeated home loads on a warm
// instance within a minute don't re-read the doc).
const snapshotMemo = createTtlCache<HomeSnapshot>({ ttlMs: 60_000 });
// Per-instance guard so concurrent requests don't each kick a rebuild.
let rebuildInFlight: Promise<HomeSnapshot | null> | null = null;

function activityFromRaw(d: FirebaseFirestore.DocumentData, ts: number): SnapshotActivity {
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
    createdAt: ts,
  };
}

/** ONE scan of recent activity → the global snapshot. The expensive op. */
async function buildSnapshot(db: FirebaseFirestore.Firestore): Promise<HomeSnapshot> {
  const snap = await db
    .collection('activities')
    .orderBy('createdAt', 'desc')
    .limit(ACTIVITY_SCAN_LIMIT)
    .get();

  const now = Date.now();
  const curCutoff = now - WINDOW_DAYS * DAY_MS;
  const priorStart = now - 2 * WINDOW_DAYS * DAY_MS;

  type Acc = {
    username: string | null;
    displayName: string | null;
    photoURL: string | null;
    cur: Set<number>;
    prior: Set<number>;
    all: Set<number>;
  };
  const perUser = new Map<string, Acc>();
  const recent: SnapshotActivity[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.userId || !d.tmdbId) continue;
    const ts = (d.createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;

    // friends-watching feed (any activity type touching a film), capped.
    if (recent.length < RECENT_LIMIT) recent.push(activityFromRaw(d, ts));

    // leaderboard tally — "seen" signals only.
    if (!LOG_TYPES.has(d.type)) continue;
    // Docs are createdAt desc → first-seen identity for a user is the newest.
    const acc = perUser.get(d.userId) ?? {
      username: d.username ?? null,
      displayName: d.displayName ?? null,
      photoURL: d.photoURL ?? null,
      cur: new Set<number>(),
      prior: new Set<number>(),
      all: new Set<number>(),
    };
    acc.all.add(d.tmdbId);
    if (ts >= curCutoff) acc.cur.add(d.tmdbId);
    else if (ts >= priorStart) acc.prior.add(d.tmdbId);
    perUser.set(d.userId, acc);
  }

  const watchers: SnapshotWatcher[] = [...perUser.entries()].map(([uid, acc]) => ({
    uid,
    username: acc.username,
    displayName: acc.displayName,
    photoURL: acc.photoURL,
    filmsCurrent: acc.cur.size,
    filmsPrior: acc.prior.size,
    filmsAll: acc.all.size,
  }));

  return { builtAt: now, windowDays: WINDOW_DAYS, watchers, recent };
}

function isValidSnapshot(s: unknown): s is HomeSnapshot {
  const o = s as HomeSnapshot | undefined;
  return !!o && typeof o.builtAt === 'number' && Array.isArray(o.watchers) && Array.isArray(o.recent);
}

/** Claim-guarded rebuild — only the instance that wins the transaction scans;
 *  others get the current (possibly stale) snapshot. */
async function tryRebuild(
  db: FirebaseFirestore.Firestore,
  current: HomeSnapshot | null,
): Promise<HomeSnapshot | null> {
  const ref = db.doc(SNAPSHOT_PATH);
  let claimed = false;
  try {
    claimed = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const d = cur.data();
      const now = Date.now();
      if (typeof d?.builtAt === 'number' && now - d.builtAt <= STALE_MS) return false; // already fresh
      if (typeof d?.rebuildingUntil === 'number' && d.rebuildingUntil > now) return false; // in progress
      tx.set(ref, { rebuildingUntil: now + CLAIM_MS }, { merge: true });
      return true;
    });
  } catch {
    claimed = false;
  }

  if (!claimed) {
    if (current) return current;
    try {
      const cur = await ref.get();
      return cur.exists && isValidSnapshot(cur.data()) ? (cur.data() as HomeSnapshot) : null;
    } catch {
      return current;
    }
  }

  try {
    const built = await buildSnapshot(db);
    await ref.set({ ...built, rebuildingUntil: 0 });
    return built;
  } catch (err) {
    console.error('[home-snapshot] rebuild failed:', err);
    // release the claim so a later request can retry
    try { await ref.set({ rebuildingUntil: 0 }, { merge: true }); } catch { /* noop */ }
    return current;
  }
}

/**
 * The global home snapshot. ~0-1 reads on the happy path (per-instance memo +
 * one doc read); a rebuild (≤ once per STALE_MS globally) does the ~800-read
 * scan. Returns null only if there's no snapshot and a rebuild couldn't run —
 * callers must fall back to their live scan.
 */
export async function getHomeSnapshot(): Promise<HomeSnapshot | null> {
  const db = getDb();
  // Under the test emulator (and the kill switch) always build fresh from the
  // current activities — no memo, no persisted/stale doc — so tests are
  // deterministic and reflect exactly what they seeded.
  if (cachingDisabled()) return buildSnapshot(db);

  let snapshot: HomeSnapshot | null = snapshotMemo.get('home') ?? null;

  if (!snapshot) {
    try {
      const doc = await db.doc(SNAPSHOT_PATH).get();
      if (doc.exists && isValidSnapshot(doc.data())) {
        snapshot = doc.data() as HomeSnapshot;
        snapshotMemo.set('home', snapshot);
      }
    } catch {
      /* fall through — treat as missing */
    }
  }

  const stale = !snapshot || Date.now() - snapshot.builtAt > STALE_MS;
  if (stale) {
    // Rebuild is claim-guarded: only the one instance that wins the transaction
    // actually scans (~once per window globally); everyone else gets the current
    // (stale-but-fine) snapshot back fast. Awaited (not fire-and-forget) so it's
    // reliable on serverless, where post-response work can be frozen. The
    // per-instance flag collapses concurrent requests to one rebuild attempt.
    if (!rebuildInFlight) {
      rebuildInFlight = tryRebuild(db, snapshot).finally(() => { rebuildInFlight = null; });
    }
    const rebuilt = await rebuildInFlight;
    if (rebuilt) { snapshot = rebuilt; snapshotMemo.set('home', rebuilt); }
  }

  return snapshot;
}

/** Force a rebuild (used by the optional cron warmer route). */
export async function rebuildHomeSnapshot(): Promise<{ builtAt: number; watchers: number } | null> {
  const db = getDb();
  const built = await buildSnapshot(db);
  await db.doc(SNAPSHOT_PATH).set({ ...built, rebuildingUntil: 0 });
  snapshotMemo.set('home', built);
  return { builtAt: built.builtAt, watchers: built.watchers.length };
}
