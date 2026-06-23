/**
 * In-process TTL cache for server-side reads (Phase 0.7 — Firestore quota
 * hardening).
 *
 * Lives at module scope, so it survives across invocations on a warm Vercel
 * (Fluid Compute) instance and absorbs bursts of identical reads — e.g. many
 * home loads hitting the same loved-lists / leaderboard / friends-watching
 * query within a minute. This is the single biggest lever against blowing the
 * Firestore daily read quota during normal browsing.
 *
 * Properties / non-goals:
 *   - Best-effort, NOT a source of truth. Not shared across instances or
 *     regions; each warm lambda keeps its own copy and a cold one just reads
 *     through. Staleness is bounded by the TTL, and the data cached here
 *     (rankings, showcases, recommendations) tolerates a minute or two of lag.
 *   - Bounded by `maxEntries` with oldest-key eviction so per-user keys can't
 *     leak memory on a long-lived instance.
 *   - Only SUCCESSFUL loader results are cached; a throw (e.g. a Firestore
 *     quota error) is never cached, so the next call retries.
 *   - DISABLED under the Firestore emulator (the audit suite) and via an
 *     explicit kill switch, so tests always see fresh, deterministic data.
 */

type Entry<T> = { value: T; expiresAt: number };

export type TtlCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  /** Drop every entry whose key starts with `prefix` (e.g. all viewer variants of a list). */
  deleteByPrefix(prefix: string): void;
};

export function createTtlCache<T>(opts: { ttlMs: number; maxEntries?: number }): TtlCache<T> {
  const ttlMs = opts.ttlMs;
  const maxEntries = opts.maxEntries ?? 1000;
  const store = new Map<string, Entry<T>>();

  return {
    get(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (Date.now() > e.expiresAt) {
        store.delete(key);
        return undefined;
      }
      // Touch for LRU recency — Map preserves insertion order, so re-inserting
      // moves the key to the newest position and the oldest stays evictable.
      store.delete(key);
      store.set(key, e);
      return e.value;
    },
    set(key, value) {
      if (!store.has(key) && store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    deleteByPrefix(prefix) {
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
  };
}

/** True when caching should be bypassed — emulator/test runs or a kill switch.
 *  Exported so bespoke caches (snapshot memo, etc.) can honor the same bypass. */
export function cachingDisabled(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST || process.env.DISABLE_SERVER_CACHE === '1';
}

/**
 * Cache-aside: return the cached value for `key`, or run `loader`, cache its
 * result, and return it. Errors propagate and are NOT cached.
 */
export async function cached<T>(
  cache: TtlCache<T>,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  if (cachingDisabled()) return loader();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cache.set(key, value);
  return value;
}
