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
 * This module keeps a process-lifetime cache keyed by a stable string. On
 * mount, `useCachedAction` returns the cached value SYNCHRONOUSLY (no
 * loading state) and kicks off a background refresh. When the refresh
 * lands, both the cache and the consuming component update with the new
 * value. First mount of a given key is the only one that shows loading;
 * every subsequent mount in the session is instant.
 *
 * Cache lifetime: module scope — survives component remounts and SPA
 * route changes, cleared on hard refresh.
 *
 * Companion: `prefetchCachedAction()` warms an entry from outside React
 * (e.g. from a `touchstart` handler on the bottom nav) so the destination
 * route finds the data already populated when it mounts.
 */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

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
  } else {
    cache.set(key, value);
  }
}

/**
 * Drop a cache entry — call after a mutation that would invalidate it.
 */
export function invalidateCachedAction(key: string): void {
  cache.delete(key);
  inflight.delete(key);
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
        setData(result);
      })
      .catch(() => {
        // Swallow — leave whatever data we already had on screen. The
        // consuming component can surface a toast via its own error layer
        // (or check `data === null && !isLoading` to detect a cold miss
        // that failed).
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
        setData(result);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [key]);

  return { data, isLoading, refetch };
}
