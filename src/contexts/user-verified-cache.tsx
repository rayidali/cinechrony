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
import { apiCall } from '@/lib/api-client';

/**
 * Loads the GLOBAL set of verified account uids once (it's tiny + public) so any
 * surface can render a verified badge with an O(1) `isVerified(uid)` check — no
 * per-author profile fetch on a feed. Mirrors the other O(1) cache providers
 * (mutes/blocks/ratings), but the set is global (not viewer-specific), so it
 * loads even when logged out (public profiles show badges too).
 */
type UserVerifiedCacheContextType = {
  isVerified: (uid: string | null | undefined) => boolean;
  isLoaded: boolean;
};

const UserVerifiedCacheContext = createContext<UserVerifiedCacheContextType | null>(null);

export function UserVerifiedCacheProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const genRef = useRef(0);

  useEffect(() => {
    const myGen = ++genRef.current;
    (async () => {
      try {
        const res = await apiCall<{ uids: string[] }>('GET', '/api/v1/verified', undefined, { skipAuth: true });
        if (genRef.current !== myGen) return;
        setIds(new Set(res.uids ?? []));
        setIsLoaded(true);
      } catch {
        // Non-fatal: no badges rather than a broken app.
        if (genRef.current === myGen) setIsLoaded(true);
      }
    })();
  }, []);

  const isVerified = useCallback((uid: string | null | undefined) => (uid ? ids.has(uid) : false), [ids]);

  return (
    <UserVerifiedCacheContext.Provider value={{ isVerified, isLoaded }}>
      {children}
    </UserVerifiedCacheContext.Provider>
  );
}

export function useUserVerified() {
  const ctx = useContext(UserVerifiedCacheContext);
  if (!ctx) throw new Error('useUserVerified must be used within UserVerifiedCacheProvider');
  return ctx;
}
