'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * AUDIT.md 2.3 Option A — part 2.
 *
 * Part 1 (2.3a) made usernames immutable, so the worst staleness class is
 * gone outright. This cache handles the remaining mutable fields
 * (displayName, photoURL) for *other* users: components rendering
 * denormalized author info (the snapshots stamped onto movies, reviews,
 * activities) read live values via `useUserProfile(uid)` and fall back to
 * the denormalized copy when the live data hasn't arrived yet.
 *
 * Scope choice (pragmatic vs perfect):
 *  - On-demand lazy fetch the first time a uid is asked for, then session-
 *    cached. NOT a per-uid onSnapshot listener — that would mean dozens
 *    of open subscriptions on a busy feed, with little marginal benefit
 *    (display names / photos don't change every few seconds).
 *  - Self-updates: when the current user changes their OWN displayName/
 *    photo via updateBio/updateProfilePhoto, callers can hit
 *    `setProfile(myUid, ...)` to refresh their own entry instantly.
 *  - Logout clears the cache.
 *
 * Failure mode is graceful: if the live fetch fails, consumers transparently
 * fall back to the denormalized copy (slightly stale, but never broken).
 */

export type CachedProfile = {
  displayName: string | null;
  photoURL: string | null;
  username: string | null; // immutable per 2.3a — included for consumer convenience
};

type ProfileMap = Map<string, CachedProfile>;

type Ctx = {
  /** Synchronous read — returns undefined if not yet loaded. Pure / safe in render. */
  getProfile: (uid: string) => CachedProfile | undefined;
  /** Idempotent: triggers a fetch if this uid isn't cached and isn't in-flight. */
  ensureFetched: (uid: string) => void;
  /** Optimistic / self-update: merges fields for `uid` into the cache. */
  setProfile: (uid: string, partial: Partial<CachedProfile>) => void;
};

const UserProfileCacheContext = createContext<Ctx | null>(null);

export function UserProfileCacheProvider({ children }: { children: ReactNode }) {
  const firestore = useFirestore();
  const { user } = useUser();
  const [profiles, setProfiles] = useState<ProfileMap>(new Map());
  // Coalesce concurrent requests for the same uid.
  const inFlightRef = useRef<Set<string>>(new Set());

  const ensureFetched = useCallback((uid: string) => {
    if (!uid) return;
    if (profiles.has(uid)) return;
    if (inFlightRef.current.has(uid)) return;
    inFlightRef.current.add(uid);
    // Fire-and-forget — components are decoupled from completion.
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'users', uid));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        const next: CachedProfile = {
          displayName: (d.displayName as string) ?? null,
          photoURL: (d.photoURL as string) ?? null,
          username: (d.username as string) ?? null,
        };
        setProfiles((prev) => {
          if (prev.has(uid)) return prev; // some other path already populated it
          const m = new Map(prev);
          m.set(uid, next);
          return m;
        });
      } catch (err) {
        // Best-effort: consumers fall back to denormalized values.
        // Don't log noisily here; bad uids in old data are common.
        if (process.env.NODE_ENV === 'development') {
          console.debug('[UserProfileCache] fetch failed for', uid, err);
        }
      } finally {
        inFlightRef.current.delete(uid);
      }
    })();
  }, [firestore, profiles]);

  const getProfile = useCallback(
    (uid: string): CachedProfile | undefined => profiles.get(uid),
    [profiles],
  );

  const setProfile = useCallback((uid: string, partial: Partial<CachedProfile>) => {
    setProfiles((prev) => {
      const cur = prev.get(uid) ?? { displayName: null, photoURL: null, username: null };
      const m = new Map(prev);
      m.set(uid, { ...cur, ...partial });
      return m;
    });
  }, []);

  // Clear cache on logout so a fresh login doesn't see stale entries from a
  // previous account.
  useEffect(() => {
    if (!user) {
      setProfiles(new Map());
      inFlightRef.current.clear();
    }
  }, [user]);

  return (
    <UserProfileCacheContext.Provider value={{ getProfile, ensureFetched, setProfile }}>
      {children}
    </UserProfileCacheContext.Provider>
  );
}

export function useUserProfileCache() {
  const ctx = useContext(UserProfileCacheContext);
  if (!ctx) {
    throw new Error('useUserProfileCache must be used within UserProfileCacheProvider');
  }
  return ctx;
}

/**
 * Convenience hook for components: pass the author's uid, get back the live
 * cached profile (or undefined while it loads). Triggers a one-shot fetch on
 * mount / when uid changes.
 *
 * Typical usage in a component rendering denormalized author info:
 *
 *   const live = useUserProfile(movie.addedBy);
 *   const displayName = live?.displayName ?? movie.addedByDisplayName ?? null;
 *   const photoURL    = live?.photoURL    ?? movie.addedByPhotoURL    ?? null;
 */
export function useUserProfile(uid: string | null | undefined): CachedProfile | undefined {
  const { getProfile, ensureFetched } = useUserProfileCache();
  useEffect(() => {
    if (uid) ensureFetched(uid);
  }, [uid, ensureFetched]);
  return uid ? getProfile(uid) : undefined;
}
