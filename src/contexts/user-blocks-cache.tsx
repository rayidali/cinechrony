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
import { apiCall } from '@/lib/api-client';

type UserBlocksCacheContextType = {
  /** Invisible either way — the viewer blocked them OR they blocked the viewer. */
  isBlocked: (uid: string) => boolean;
  /** The viewer actively blocked this user (drives "unblock" affordances). */
  didIBlock: (uid: string) => boolean;
  /** Optimistically flip the viewer's own block on a user. */
  setBlocked: (uid: string, blocked: boolean) => void;
  isLoaded: boolean;
};

const UserBlocksCacheContext = createContext<UserBlocksCacheContextType | null>(null);

/**
 * Loads the viewer's block context once — both directions — so every read
 * surface can filter blocked users with no per-item fetch. The backbone of
 * LAUNCH 0.5.5's mutual invisibility.
 */
export function UserBlocksCacheProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [iBlocked, setIBlocked] = useState<Set<string>>(new Set());
  const [blockedMe, setBlockedMe] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const genRef = useRef(0);

  const fetchBlocks = useCallback(async () => {
    if (!user) {
      genRef.current++;
      setIBlocked(new Set());
      setBlockedMe(new Set());
      setIsLoaded(false);
      return;
    }
    const myGen = ++genRef.current;
    try {
      const res = await apiCall<{ blockedIds: string[]; iBlocked: string[] }>(
        'GET', '/api/v1/me/block-context',
      );
      if (genRef.current !== myGen) return;
      const ib = new Set(res.iBlocked ?? []);
      const union = new Set(res.blockedIds ?? []);
      setIBlocked(ib);
      setBlockedMe(new Set([...union].filter((u) => !ib.has(u))));
      setIsLoaded(true);
    } catch (error) {
      console.error('Failed to load block context:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const isBlocked = useCallback(
    (uid: string) => iBlocked.has(uid) || blockedMe.has(uid),
    [iBlocked, blockedMe],
  );
  const didIBlock = useCallback((uid: string) => iBlocked.has(uid), [iBlocked]);

  const setBlocked = useCallback((uid: string, blocked: boolean) => {
    setIBlocked((prev) => {
      const next = new Set(prev);
      if (blocked) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }, []);

  return (
    <UserBlocksCacheContext.Provider value={{ isBlocked, didIBlock, setBlocked, isLoaded }}>
      {children}
    </UserBlocksCacheContext.Provider>
  );
}

export function useUserBlocksCache() {
  const context = useContext(UserBlocksCacheContext);
  if (!context) {
    throw new Error('useUserBlocksCache must be used within UserBlocksCacheProvider');
  }
  return context;
}
