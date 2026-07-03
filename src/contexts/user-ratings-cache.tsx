'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import type { UserRating } from '@/lib/types';

type RatingsMap = Map<number, number>; // tmdbId -> rating

type UserRatingsCacheContextType = {
  /** Get rating for a movie by tmdbId - O(1) lookup */
  getRating: (tmdbId: number) => number | null;
  /** Check if ratings have been loaded */
  isLoaded: boolean;
  /** Check if ratings are currently loading */
  isLoading: boolean;
  /** Manually refresh ratings (e.g., after adding a new rating) */
  refreshRatings: () => Promise<void>;
  /** Update a single rating in the cache (optimistic update) */
  setRating: (tmdbId: number, rating: number | null) => void;
};

const UserRatingsCacheContext = createContext<UserRatingsCacheContextType | null>(null);

// AUDIT.md 2.5: page size for the paginated fetch. Letterboxd importers
// routinely cross 1000 ratings; the old single 500-call cap silently dropped
// the tail. This loops until the server returns less than a full page.
const PAGE_SIZE = 500;

// Persistence (2026-07 perf pass). The ratings map is the single largest
// per-boot Firestore cost — a 2,000-film Letterboxd importer re-read its ENTIRE
// /ratings collection (~2,000 billed reads + up to 4 serial round trips) on
// every app open, no persistence, no TTL. Now: persist the map to localStorage
// keyed by uid, paint it synchronously on boot (instant rating chips, zero
// stall), then DELTA-sync only ratings changed since the last high-water mark
// (steady-state ≈ 1 read/open). A periodic full refresh bounds staleness from
// cross-device deletions the delta can't see.
const PERSIST_PREFIX = 'cc-ratings:';
const FULL_REFRESH_MS = 24 * 60 * 60 * 1000; // force a full re-read at least daily

type PersistedRatings = {
  v: 1;
  entries: [number, number][]; // [tmdbId, rating]
  maxUpdatedAt: string | null; // ISO high-water mark for delta sync
  syncedAt: number; // epoch ms of the last successful full/delta sync
};

function readPersisted(uid: string): PersistedRatings | null {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRatings;
    if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted(uid: string, map: RatingsMap, maxUpdatedAt: string | null) {
  try {
    const payload: PersistedRatings = {
      v: 1,
      entries: Array.from(map.entries()),
      maxUpdatedAt,
      syncedAt: Date.now(),
    };
    localStorage.setItem(PERSIST_PREFIX + uid, JSON.stringify(payload));
  } catch {
    /* quota / private mode — persistence is best-effort, the in-memory map still works */
  }
}

export function UserRatingsCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [ratingsMap, setRatingsMap] = useState<RatingsMap>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Server-side high-water mark (max updatedAt we've synced). Drives delta sync.
  // A ref, not state — it never needs to trigger a render.
  const maxUpdatedAtRef = useRef<string | null>(null);

  // Generation counter — each fetch claims an id; only the latest may write to
  // state. Closes the audit-2.5 race where an in-flight fetch from before
  // logout could repopulate the cleared cache for the next user.
  const fetchGenRef = useRef(0);

  const fetchRatings = useCallback(async () => {
    if (!user?.uid) {
      // Bump generation so any in-flight earlier fetch's writes are ignored.
      fetchGenRef.current++;
      maxUpdatedAtRef.current = null;
      setRatingsMap(new Map());
      setIsLoaded(false);
      return;
    }
    const uid = user.uid;
    const myGen = ++fetchGenRef.current;

    // 1. Seed synchronously from localStorage so rating chips paint instantly.
    const persisted = readPersisted(uid);
    const seeded = new Map<number, number>();
    let mode: 'full' | 'delta' = 'full';
    let since: string | undefined;
    if (persisted) {
      for (const [id, r] of persisted.entries) seeded.set(id, r);
      maxUpdatedAtRef.current = persisted.maxUpdatedAt;
      setRatingsMap(seeded);
      setIsLoaded(true);
      // Fresh enough + we have a cursor → sync only the delta.
      if (persisted.maxUpdatedAt && Date.now() - persisted.syncedAt < FULL_REFRESH_MS) {
        mode = 'delta';
        since = persisted.maxUpdatedAt;
      }
    }

    setIsLoading(true);
    // Delta merges into the seeded map; full rebuilds from scratch.
    const map = mode === 'delta' ? new Map(seeded) : new Map<number, number>();
    let maxUpdatedAt = mode === 'delta' ? maxUpdatedAtRef.current : null;
    try {
      let cursor: string | undefined;
      // Paginate until a short page (or empty) — guaranteed to terminate
      // because results are ordered by updatedAt desc and the cursor is the
      // last seen value, so we always move forward. The 50-iter cap guards a
      // misbehaving cursor (e.g. ties in updatedAt).
      for (let i = 0; i < 50; i++) {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) qs.set('cursor', cursor);
        if (since && !cursor) qs.set('since', since); // delta filter on page 1
        const result = await apiCall<{ ratings: UserRating[]; hasMore: boolean; nextCursor?: string }>(
          'GET',
          `/api/v1/users/${uid}/ratings?${qs.toString()}`,
        );
        // If a newer fetch (or logout) bumped the generation, abandon.
        if (fetchGenRef.current !== myGen) return;
        if (!result.ratings || result.ratings.length === 0) break;

        for (const r of result.ratings) {
          map.set(r.tmdbId, r.rating);
          // updatedAt arrives as an ISO string over JSON; track the max.
          const u = r.updatedAt as unknown as string | undefined;
          if (u && (!maxUpdatedAt || u > maxUpdatedAt)) maxUpdatedAt = u;
        }

        if (!result.hasMore) break;
        if (!result.nextCursor || cursor === result.nextCursor) break; // safety
        cursor = result.nextCursor;
      }

      if (fetchGenRef.current !== myGen) return;
      maxUpdatedAtRef.current = maxUpdatedAt;
      setRatingsMap(map);
      setIsLoaded(true);
      writePersisted(uid, map, maxUpdatedAt);
    } catch (error) {
      console.error('Failed to fetch user ratings:', error);
      // On failure we keep the seeded (persisted) map — never blank the chips.
    } finally {
      if (fetchGenRef.current === myGen) setIsLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchRatings();
  }, [fetchRatings]);

  const getRating = useCallback((tmdbId: number): number | null => {
    return ratingsMap.get(tmdbId) ?? null;
  }, [ratingsMap]);

  const refreshRatings = useCallback(async () => {
    await fetchRatings();
  }, [fetchRatings]);

  const setRating = useCallback((tmdbId: number, rating: number | null) => {
    setRatingsMap(prev => {
      const newMap = new Map(prev);
      if (rating === null) {
        newMap.delete(tmdbId);
      } else {
        newMap.set(tmdbId, rating);
      }
      // Persist the optimistic write so it survives a reload. Keep the delta
      // cursor unchanged (we don't know this write's server updatedAt) — the
      // authoritative doc flows in on the next delta sync and overwrites.
      if (user?.uid) writePersisted(user.uid, newMap, maxUpdatedAtRef.current);
      return newMap;
    });
  }, [user?.uid]);

  return (
    <UserRatingsCacheContext.Provider value={{ getRating, isLoaded, isLoading, refreshRatings, setRating }}>
      {children}
    </UserRatingsCacheContext.Provider>
  );
}

export function useUserRatingsCache() {
  const context = useContext(UserRatingsCacheContext);
  if (!context) {
    throw new Error('useUserRatingsCache must be used within UserRatingsCacheProvider');
  }
  return context;
}
