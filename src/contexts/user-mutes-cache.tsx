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

type UserMutesCacheContextType = {
  /** O(1) check — has the viewer muted this user? */
  isMuted: (uid: string) => boolean;
  /** Optimistically flip a mute in the cache. */
  setMuted: (uid: string, muted: boolean) => void;
  isLoaded: boolean;
};

const UserMutesCacheContext = createContext<UserMutesCacheContextType | null>(null);

/** Loads the viewer's muted-user ids once so the feed can hide them with no per-card fetch. */
export function UserMutesCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const genRef = useRef(0);

  const fetchMutes = useCallback(async () => {
    if (!user) {
      genRef.current++;
      setIds(new Set());
      setIsLoaded(false);
      return;
    }
    const myGen = ++genRef.current;
    try {
      const boot = await prefetchCachedAction(bootCacheKey(user.uid), fetchBoot);
      if (genRef.current !== myGen) return;
      setIds(new Set(boot.mutes?.mutedIds ?? []));
      setIsLoaded(true);
    } catch (error) {
      console.error('Failed to load mutes:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchMutes();
  }, [fetchMutes]);

  const isMuted = useCallback((uid: string) => ids.has(uid), [ids]);

  const setMuted = useCallback((uid: string, muted: boolean) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (muted) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }, []);

  return (
    <UserMutesCacheContext.Provider value={{ isMuted, setMuted, isLoaded }}>
      {children}
    </UserMutesCacheContext.Provider>
  );
}

export function useUserMutesCache() {
  const context = useContext(UserMutesCacheContext);
  if (!context) {
    throw new Error('useUserMutesCache must be used within UserMutesCacheProvider');
  }
  return context;
}
