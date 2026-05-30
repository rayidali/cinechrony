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

export function UserRatingsCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [ratingsMap, setRatingsMap] = useState<RatingsMap>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Generation counter — each fetch claims an id; only the latest may write to
  // state. Closes the audit-2.5 race where an in-flight fetch from before
  // logout could repopulate the cleared cache for the next user.
  const fetchGenRef = useRef(0);

  const fetchRatings = useCallback(async () => {
    if (!user?.uid) {
      // Bump generation so any in-flight earlier fetch's writes are ignored.
      fetchGenRef.current++;
      setRatingsMap(new Map());
      setIsLoaded(false);
      return;
    }

    const myGen = ++fetchGenRef.current;
    setIsLoading(true);
    const map = new Map<number, number>();
    try {
      let cursor: string | undefined;
      // Paginate until a short page (or empty) — guaranteed to terminate
      // because results are ordered by updatedAt desc and the cursor is the
      // last seen value, so we always move forward.
      // Defensive max-iterations cap protects against runaway loops if the
      // cursor mechanism ever misbehaves (e.g. ties in updatedAt).
      for (let i = 0; i < 50; i++) {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) qs.set('cursor', cursor);
        const result = await apiCall<{ ratings: UserRating[]; hasMore: boolean; nextCursor?: string }>(
          'GET',
          `/api/v1/users/${user.uid}/ratings?${qs.toString()}`,
        );
        // If a newer fetch (or logout) bumped the generation, abandon — don't
        // pollute the new state.
        if (fetchGenRef.current !== myGen) return;
        if (!result.ratings || result.ratings.length === 0) break;

        for (const r of result.ratings) {
          map.set(r.tmdbId, r.rating);
        }

        if (!result.hasMore) break; // last page (route returns hasMore explicitly)

        if (!result.nextCursor || cursor === result.nextCursor) break; // safety
        cursor = result.nextCursor;
      }

      // Final guard before writing.
      if (fetchGenRef.current !== myGen) return;
      setRatingsMap(map);
      setIsLoaded(true);
    } catch (error) {
      console.error('Failed to fetch user ratings:', error);
    } finally {
      // Only the latest fetch flips the loading flag back.
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
      return newMap;
    });
  }, []);

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
