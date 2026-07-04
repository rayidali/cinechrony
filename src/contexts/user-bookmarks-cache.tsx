'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useUser } from '@/firebase';
import { prefetchCachedAction } from '@/lib/use-cached-action';
import { fetchBoot, bootCacheKey } from '@/lib/boot-client';

type UserBookmarksCacheContextType = {
  /** O(1) check — is this feed item in the viewer's archive? */
  isSaved: (itemType: string, itemId: string) => boolean;
  /** Optimistically flip a bookmark in the cache. */
  setSaved: (itemType: string, itemId: string, saved: boolean) => void;
  isLoaded: boolean;
};

const UserBookmarksCacheContext = createContext<UserBookmarksCacheContextType | null>(null);

/**
 * Loads the viewer's bookmark keys (`{type}_{id}`) once into a Set so every
 * card can render its saved state with no per-card fetch — the same pattern as
 * UserRatingsCacheProvider.
 */
export function UserBookmarksCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const genRef = useRef(0);

  const fetchBookmarks = useCallback(async () => {
    if (!user) {
      genRef.current++;
      setKeys(new Set());
      setIsLoaded(false);
      return;
    }
    const myGen = ++genRef.current;
    try {
      // Coalesced boot fetch — shares ONE /me/boot call with the mutes + blocks
      // providers instead of three separate cold serverless round trips.
      const boot = await prefetchCachedAction(bootCacheKey(user.uid), fetchBoot);
      if (genRef.current !== myGen) return;
      setKeys(new Set(boot.bookmarks?.keys ?? []));
      setIsLoaded(true);
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const isSaved = useCallback(
    (itemType: string, itemId: string) => keys.has(`${itemType}_${itemId}`),
    [keys],
  );

  const setSaved = useCallback((itemType: string, itemId: string, saved: boolean) => {
    setKeys((prev) => {
      const next = new Set(prev);
      const key = `${itemType}_${itemId}`;
      if (saved) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  return (
    <UserBookmarksCacheContext.Provider value={{ isSaved, setSaved, isLoaded }}>
      {children}
    </UserBookmarksCacheContext.Provider>
  );
}

export function useUserBookmarksCache() {
  const context = useContext(UserBookmarksCacheContext);
  if (!context) {
    throw new Error('useUserBookmarksCache must be used within UserBookmarksCacheProvider');
  }
  return context;
}
