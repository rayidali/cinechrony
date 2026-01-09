'use client';

import { createContext, useContext, useCallback, useRef, ReactNode } from 'react';
import type { ListMember } from '@/lib/types';

type CacheEntry = {
  members: ListMember[];
  timestamp: number;
};

type ListMembersCacheContextType = {
  getMembers: (listOwnerId: string, listId: string) => ListMember[] | null;
  setMembers: (listOwnerId: string, listId: string, members: ListMember[]) => void;
  invalidate: (listOwnerId: string, listId: string) => void;
};

const ListMembersCacheContext = createContext<ListMembersCacheContextType | null>(null);

// Cache TTL: 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

export function ListMembersCacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const getCacheKey = (listOwnerId: string, listId: string) => `${listOwnerId}:${listId}`;

  const getMembers = useCallback((listOwnerId: string, listId: string): ListMember[] | null => {
    const key = getCacheKey(listOwnerId, listId);
    const entry = cacheRef.current.get(key);

    if (!entry) return null;

    // Check if cache is still valid
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      cacheRef.current.delete(key);
      return null;
    }

    return entry.members;
  }, []);

  const setMembers = useCallback((listOwnerId: string, listId: string, members: ListMember[]) => {
    const key = getCacheKey(listOwnerId, listId);
    cacheRef.current.set(key, {
      members,
      timestamp: Date.now(),
    });
  }, []);

  const invalidate = useCallback((listOwnerId: string, listId: string) => {
    const key = getCacheKey(listOwnerId, listId);
    cacheRef.current.delete(key);
  }, []);

  return (
    <ListMembersCacheContext.Provider value={{ getMembers, setMembers, invalidate }}>
      {children}
    </ListMembersCacheContext.Provider>
  );
}

export function useListMembersCache() {
  const context = useContext(ListMembersCacheContext);
  if (!context) {
    throw new Error('useListMembersCache must be used within ListMembersCacheProvider');
  }
  return context;
}
