'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useUser } from '@/firebase';
import { getUserRatings } from '@/app/actions';
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

export function UserRatingsCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [ratingsMap, setRatingsMap] = useState<RatingsMap>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch all user ratings once
  const fetchRatings = useCallback(async () => {
    if (!user?.uid) {
      setRatingsMap(new Map());
      setIsLoaded(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await getUserRatings(user.uid, 500); // Get up to 500 ratings
      if (result.ratings) {
        const map = new Map<number, number>();
        result.ratings.forEach((r: UserRating) => {
          map.set(r.tmdbId, r.rating);
        });
        setRatingsMap(map);
        setIsLoaded(true);
      }
    } catch (error) {
      console.error('Failed to fetch user ratings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  // Load ratings when user changes
  useEffect(() => {
    fetchRatings();
  }, [fetchRatings]);

  // Get rating by tmdbId - O(1) lookup
  const getRating = useCallback((tmdbId: number): number | null => {
    return ratingsMap.get(tmdbId) ?? null;
  }, [ratingsMap]);

  // Refresh ratings manually
  const refreshRatings = useCallback(async () => {
    await fetchRatings();
  }, [fetchRatings]);

  // Update a single rating in cache (for optimistic updates)
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
