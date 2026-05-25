'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * SWR (stale-while-revalidate) cache for server-action results.
 *
 * Why this exists: every tab switch in this app unmounts the page and its
 * children, throwing away whatever the destination route had loaded. The
 * next mount fires the fetch from scratch — the user sees a skeleton for
 * ~300-800ms even though the underlying data hasn't changed.
 *
 * Two layers of cache:
 *   1. **Module-level Map** — survives component remounts and SPA route
 *      changes within a single page load.
 *   2. **localStorage** — for keys explicitly opted in via the
 *      `persist: true` option. Survives a full app reload / closed-and-
 *      reopened PWA, so cold opens paint the prior state synchronously
 *      from disk before any network round-trip.
 *
 * On mount, `useCachedAction` returns the cached value SYNCHRONOUSLY (no
 * loading state) and kicks off a background refresh. When the refresh
 * lands, both the cache and the consuming component update with the new
 * value.
 *
 * Companion: `prefetchCachedAction()` warms an entry from outside React
 * (e.g. from a `touchstart` handler on the bottom nav) so the destination
 * route finds the data already populated when it mounts.
 */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const persistedKeys = new Set<string>();
const LS_PREFIX = 'cc-cache:';

function lsReadOnce<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function lsWrite<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota exceeded / Safari private mode — degrade silently */
  }
}

function lsRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* noop */
  }
}

/**
 * Opt a cache key into localStorage persistence. Call once at module
 * load — after that, every cache read for this key first checks
 * localStorage on a cold module, every cache write also writes to
 * localStorage. Call before any consumers mount.
 *
 * Caveats: values must be JSON-serializable. Firestore `Timestamp`s
 * survive JSON round-trip only as plain objects — re-hydrate if you need
 * Date semantics on the consuming side, or accept that timestamps are
 * read-only strings post-persist.
 */
export function registerPersistedCache(key: string): void {
  persistedKeys.add(key);
  // On first registration, eagerly hydrate the in-memory cache from
  // localStorage so the very first synchronous read sees it.
  if (!cache.has(key)) {
    const stored = lsReadOnce(key);
    if (stored !== undefined) cache.set(key, stored);
  }
}

/**
 * Persist matching keys by prefix — useful for user-scoped caches whose
 * exact key isn't known until login (`home-feed:${uid}`). Call once at
 * module load with a stable prefix; the prefix match is checked at every
 * write.
 */
const persistedPrefixes = new Set<string>();
export function registerPersistedPrefix(prefix: string): void {
  persistedPrefixes.add(prefix);
  if (typeof window === 'undefined') return;
  // Hydrate any matching keys already in localStorage into the in-memory
  // cache on first registration.
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      const cacheKey = k.slice(LS_PREFIX.length);
      if (cacheKey.startsWith(prefix) && !cache.has(cacheKey)) {
        const stored = lsReadOnce(cacheKey);
        if (stored !== undefined) cache.set(cacheKey, stored);
      }
    }
  } catch {
    /* localStorage iteration can throw in some private modes */
  }
}

function shouldPersist(key: string): boolean {
  if (persistedKeys.has(key)) return true;
  for (const prefix of persistedPrefixes) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

type ActionResult<T> = {
  /** Latest known value — synchronous on cache hit, null on cold first load. */
  data: T | null;
  /** True only when there's no cached value AND a fetch is in flight. */
  isLoading: boolean;
  /** Force a fresh fetch ignoring the cache. */
  refetch: () => void;
};

/**
 * Synchronous cache read. Returns the cached value or `undefined` if the
 * key hasn't been populated yet. Use this to seed component state before
 * the first render so there's no loading flash.
 */
export function readCachedAction<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

/**
 * Manually replace a cache entry — for optimistic updates after a write.
 * Pass `undefined` to invalidate without setting a new value.
 */
export function setCachedAction<T>(key: string, value: T | undefined): void {
  if (value === undefined) {
    cache.delete(key);
    if (shouldPersist(key)) lsRemove(key);
  } else {
    cache.set(key, value);
    if (shouldPersist(key)) lsWrite(key, value);
  }
}

/**
 * Drop a cache entry — call after a mutation that would invalidate it.
 */
export function invalidateCachedAction(key: string): void {
  cache.delete(key);
  inflight.delete(key);
  if (shouldPersist(key)) lsRemove(key);
}

/**
 * Drop every cache entry whose key starts with `prefix`. Use for bulk
 * invalidation (e.g. "every cache that belongs to this user").
 */
export function invalidateCachedActionsByPrefix(prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      inflight.delete(key);
      if (shouldPersist(key)) lsRemove(key);
    }
  }
}

/**
 * Warm the cache for a key WITHOUT mounting a component. Returns the same
 * promise that any in-flight or future `useCachedAction(key)` will await,
 * so calling this on `touchstart` and then mounting the consumer on `click`
 * is a single coalesced fetch.
 *
 * The fetcher only runs if the cache is cold and no fetch is already
 * inflight — calling this repeatedly is safe and cheap.
 */
export function prefetchCachedAction<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key) as T | undefined;
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await fetcher();
      cache.set(key, result);
      if (shouldPersist(key)) lsWrite(key, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/**
 * SWR hook around an async server action.
 *
 * `key` is the cache contract — pass a stable string that uniquely
 * identifies what the fetcher returns (include user id, params, etc.).
 * Pass `null` to disable (returns `{ data: null, isLoading: false }`).
 *
 * `fetcher` doesn't need to be stable — it's read via a ref so closures
 * over component state stay fresh. The effect re-runs only when `key`
 * changes.
 */
export function useCachedAction<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): ActionResult<T> {
  // Synchronous initial read so the first render paints with cached data.
  const initial = key ? (cache.get(key) as T | undefined) : undefined;
  const [data, setData] = useState<T | null>(initial ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(
    initial === undefined && key !== null,
  );

  // Track the latest fetcher without re-running the effect when it changes.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!key) {
      setData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    // If we have a cache entry, show it now and refresh silently.
    const cached = cache.get(key) as T | undefined;
    if (cached !== undefined) {
      setData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // Coalesce concurrent callers for the same key onto a single promise.
    let promise = inflight.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = (async () => {
        try {
          return await fetcherRef.current();
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
    }

    promise
      .then((result) => {
        if (cancelled) return;
        cache.set(key, result);
        if (shouldPersist(key)) lsWrite(key, result);
        setData(result);
      })
      .catch(() => {
        // Swallow — leave whatever data we already had on screen.
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const refetch = useCallback(() => {
    if (!key) return;
    cache.delete(key);
    inflight.delete(key);
    setIsLoading(true);
    const promise = (async () => {
      try {
        return await fetcherRef.current();
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    promise
      .then((result) => {
        cache.set(key, result);
        if (shouldPersist(key)) lsWrite(key, result);
        setData(result);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [key]);

  return { data, isLoading, refetch };
}
