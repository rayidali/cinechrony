'use client';

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { Loader2, Film, Users, Bookmark } from 'lucide-react';
import { Link } from '@/lib/native-nav';
import type { FriendsWatchingCard as FWCard } from '@/lib/friends-watching-server';
import type { RecommendationSet } from '@/lib/tmdb-server';
import type { FeedItem } from '@/lib/posts-server';
import type { HotTake } from '@/lib/reviews-server';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/firebase';
import {
  readCachedAction,
  setCachedAction,
  isCachedActionFresh,
  invalidateCachedActionsByPrefix,
} from '@/lib/use-cached-action';

// Freshness windows — within these, a mount reuses cache instead of refetching
// (the single biggest Firestore-read saver on repeat home loads). Pull-to-
// refresh (a `refreshKey` bump) always bypasses these.
const FEED_STALE_MS = 120_000; // 2 min
const RAILS_STALE_MS = 300_000; // 5 min — recs + friends-watching
import { useUserMutesCache } from '@/contexts/user-mutes-cache';
import { useUserBlocksCache } from '@/contexts/user-blocks-cache';
import type { Activity, Movie } from '@/lib/types';
import { ActivityCard } from './activity-card';
import { PostCard } from './post-card';
import { RecommendationCard } from './recommendation-card';
import { FriendsWatchingCard } from './friends-watching-card';
import { HotTakeCard } from './hot-take-card';
import { useMovieModal } from '@/contexts/movie-modal-context';

type ActivityFeedProps = {
  currentUserId: string | null;
  refreshKey?: number;
  /** `friends` narrows to followed users; `saved` shows the bookmarks feed. */
  feedFilter?: 'all' | 'saved' | 'friends';
  /** UIDs the viewer follows — required for the `friends` filter. */
  followingIds?: string[];
};

const feedItemAuthor = (item: FeedItem) =>
  item.kind === 'activity' ? item.activity.userId : item.post.authorId;
const feedItemId = (item: FeedItem) =>
  item.kind === 'activity' ? `a_${item.activity.id}` : `p_${item.post.id}`;

// Skeleton loader for the initial load — mirrors the borderless diary reel
// (divide-y rows, 48×72 poster chip) so there's no card→stream layout jump on
// hydration.
function FeedSkeleton() {
  return (
    <div className="divide-y divide-hair">
      {[1, 2, 3].map((i) => (
        <div key={i} className="py-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-4 bg-muted rounded animate-pulse w-24 mb-1" />
              <div className="h-3 bg-muted rounded animate-pulse w-16" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-12 h-[72px] rounded-[10px] bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-5 bg-muted rounded animate-pulse w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded animate-pulse w-1/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingMore() {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// Empty state — editorial, per UX_PATTERNS microcopy bank.
function EmptyState({ feedFilter }: { feedFilter: 'all' | 'saved' | 'friends' }) {
  if (feedFilter === 'saved') {
    return (
      <div className="text-center py-16 px-6">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-muted flex items-center justify-center">
          <Bookmark className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <p className="cc-lead text-[15px] text-muted-foreground max-w-[18rem] mx-auto">
          nothing saved yet. tap the bookmark on a card to start your archive.
        </p>
      </div>
    );
  }
  const isFriends = feedFilter === 'friends';
  return (
    <div className="text-center py-16 px-6">
      <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-muted flex items-center justify-center">
        {isFriends ? (
          <Users className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
        ) : (
          <Film className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
        )}
      </div>
      <p className="cc-lead text-[15px] text-muted-foreground max-w-[18rem] mx-auto mb-5">
        {isFriends
          ? 'no posts from people you follow lately.'
          : 'nothing here yet. share a take or scan a clip to get started.'}
      </p>
      <Link
        href="/profile"
        className="inline-flex items-center gap-2 px-5 py-2.5 border border-foreground rounded-full font-headline font-semibold text-sm lowercase tracking-tight transition-colors hover:bg-foreground hover:text-background"
      >
        <Users className="h-4 w-4" strokeWidth={1.8} />
        find friends
      </Link>
    </div>
  );
}

function EndOfFeed() {
  return (
    <div className="text-center py-6 cc-lead text-sm text-muted-foreground italic">
      — you&apos;re all caught up —
    </div>
  );
}

/**
 * The home feed — the unified, paginated stream of system activities + user
 * posts (getHomeFeed), with recommendation and friends-watching cards
 * interleaved. The `saved` filter swaps in the bookmarks feed.
 */
export function ActivityFeed({
  currentUserId,
  refreshKey = 0,
  feedFilter = 'all',
  followingIds,
}: ActivityFeedProps) {
  const auth = useAuth();
  const { isMuted } = useUserMutesCache();
  const { isBlocked } = useUserBlocksCache();

  // SWR caches — key by user + filter so a/b filter swaps don't bleed.
  // We cache the first page only; pagination state stays local. That means
  // tab returns paint the first scroll-worth synchronously, and the user
  // pays for pagination again on return (acceptable — most users only see
  // page 1 anyway).
  // `all` and `friends` fetch the SAME /api/v1/home-feed payload — friends is a
  // pure client-side narrowing by followingIds (below) — so they share one
  // cache key. Switching between the two headline tabs is then an instant
  // re-filter with zero refetch and zero skeleton (was: a full skeleton + a
  // redundant server hit on every switch). `saved` keeps its own key + endpoint.
  const feedCacheFilter = feedFilter === 'saved' ? 'saved' : 'all';
  const feedKey = currentUserId ? `home-feed:${currentUserId}:${feedCacheFilter}` : null;
  const recKey = currentUserId ? `home-recs:${currentUserId}` : null;
  const fwKey = currentUserId ? `home-fw:${currentUserId}` : null;
  const htKey = currentUserId ? `home-hot-takes:${currentUserId}` : null;

  type FeedSnapshot = { items: FeedItem[]; hasMore: boolean; cursor: string | null };
  const cachedFeed = feedKey ? readCachedAction<FeedSnapshot>(feedKey) : undefined;
  const cachedRecs = recKey ? readCachedAction<RecommendationSet[]>(recKey) : undefined;
  const cachedFw = fwKey ? readCachedAction<FWCard[]>(fwKey) : undefined;
  const cachedHt = htKey ? readCachedAction<HotTake[]>(htKey) : undefined;

  const [items, setItems] = useState<FeedItem[]>(cachedFeed?.items ?? []);
  const [recSets, setRecSets] = useState<RecommendationSet[]>(cachedRecs ?? []);
  const [fwCards, setFwCards] = useState<FWCard[]>(cachedFw ?? []);
  const [hotTakes, setHotTakes] = useState<HotTake[]>(cachedHt ?? []);
  const [isLoading, setIsLoading] = useState(cachedFeed === undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(cachedFeed?.hasMore ?? false);
  const [cursor, setCursor] = useState<string | null>(cachedFeed?.cursor ?? null);
  const [error, setError] = useState<string | null>(null);

  const { openMovie } = useMovieModal();

  const sentinelRef = useRef<HTMLDivElement>(null);
  // Track refreshKey per-effect so a pull-to-refresh forces a refetch but a
  // plain remount respects the freshness window.
  const lastFeedRefreshRef = useRef(refreshKey);
  const lastRailsRefreshRef = useRef(refreshKey);

  // Fetch one page — `saved` reads the bookmarks feed, everything else the
  // merged home feed (activities + posts).
  const fetchPage = useCallback(
    async (pageCursor?: string) => {
      if (feedCacheFilter === 'saved') {
        const qs = new URLSearchParams();
        if (pageCursor) qs.set('cursor', pageCursor);
        try {
          const r = await apiCall<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string }>(
            'GET',
            `/api/v1/saved-feed${qs.toString() ? `?${qs.toString()}` : ''}`,
          );
          return { items: r.items, hasMore: r.hasMore, nextCursor: r.nextCursor } as {
            items: FeedItem[]; hasMore: boolean; nextCursor?: string; error?: string;
          };
        } catch (err) {
          return {
            items: [], hasMore: false,
            error: err instanceof ApiClientError ? err.message : 'failed to load saved feed.',
          };
        }
      }
      // Home feed via /api/v1/home-feed — apiCall throws on error; we map
      // back to the {error} shape callers below expect.
      try {
        const qs = new URLSearchParams();
        if (pageCursor) qs.set('cursor', pageCursor);
        const r = await apiCall<{ items: FeedItem[]; hasMore: boolean; nextCursor?: string }>(
          'GET',
          `/api/v1/home-feed${qs.toString() ? `?${qs.toString()}` : ''}`,
        );
        return { items: r.items, hasMore: r.hasMore, nextCursor: r.nextCursor } as {
          items: FeedItem[];
          hasMore: boolean;
          nextCursor?: string;
          error?: string;
        };
      } catch (err) {
        return {
          items: [] as FeedItem[],
          hasMore: false,
          error: err instanceof ApiClientError ? err.message : 'Failed to load the feed.',
        };
      }
    },
    [feedCacheFilter, auth],
  );

  // Initial load (refresh on refreshKey; reload when the filter changes).
  // SWR semantics: if the cache had a hit, we already painted with it on
  // first render — skip the loading state and refresh silently. Cold miss
  // shows the skeleton, then swaps in on first fetch.
  useEffect(() => {
    let cancelled = false;
    const forced = lastFeedRefreshRef.current !== refreshKey;
    lastFeedRefreshRef.current = refreshKey;
    (async () => {
      try {
        const hadCached = feedKey ? readCachedAction(feedKey) !== undefined : false;
        // Fresh cache + not a pull-to-refresh → reuse it, skip the read.
        if (hadCached && !forced && feedKey && isCachedActionFresh(feedKey, FEED_STALE_MS)) {
          setIsLoading(false);
          return;
        }
        if (!hadCached) setIsLoading(true);
        setError(null);
        const result = await fetchPage();
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          setItems(result.items);
          setHasMore(result.hasMore);
          setCursor(result.nextCursor || null);
          if (feedKey) {
            setCachedAction<FeedSnapshot>(feedKey, {
              items: result.items,
              hasMore: result.hasMore,
              cursor: result.nextCursor || null,
            });
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load the feed');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, fetchPage, feedKey]);

  // "for you" recommendations + friends-watching — interleaved into the
  // feed. Both are cached so tab returns paint the prior cards while we
  // refresh in the background.
  useEffect(() => {
    let cancelled = false;
    const forced = lastRailsRefreshRef.current !== refreshKey;
    lastRailsRefreshRef.current = refreshKey;
    // Fresh recs + friends-watching + hot-takes → skip all three reads on a
    // plain remount.
    if (!forced && recKey && fwKey && htKey
        && isCachedActionFresh(recKey, RAILS_STALE_MS)
        && isCachedActionFresh(fwKey, RAILS_STALE_MS)
        && isCachedActionFresh(htKey, RAILS_STALE_MS)
        && readCachedAction(recKey) !== undefined
        && readCachedAction(fwKey) !== undefined
        && readCachedAction(htKey) !== undefined) {
      return;
    }
    (async () => {
      try {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        if (!idToken) return;
        const [recs, fw, ht] = await Promise.all([
          apiCall<{ sets: RecommendationSet[] }>('GET', '/api/v1/recommendations')
            .catch(() => ({ sets: [] as RecommendationSet[] })),
          apiCall<{ cards: FWCard[] }>('GET', '/api/v1/friends-watching')
            .catch(() => ({ cards: [] as FWCard[] })),
          apiCall<{ highlights: HotTake[] }>('GET', '/api/v1/reviews/highlights')
            .catch(() => ({ highlights: [] as HotTake[] })),
        ]);
        if (cancelled) return;
        const sets = recs.sets ?? [];
        setRecSets(sets);
        if (recKey) setCachedAction(recKey, sets);
        const cards = fw.cards ?? [];
        setFwCards(cards);
        if (fwKey) setCachedAction(fwKey, cards);
        const takes = ht.highlights ?? [];
        setHotTakes(takes);
        if (htKey) setCachedAction(htKey, takes);
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, refreshKey, recKey, fwKey, htKey]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !cursor) return;
    try {
      setIsLoadingMore(true);
      const result = await fetchPage(cursor);
      if (result.error) {
        setError(result.error);
      } else {
        setItems((prev) => [...prev, ...result.items]);
        setHasMore(result.hasMore);
        setCursor(result.nextCursor || null);
      }
    } catch {
      setError('Failed to load more');
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, hasMore, isLoadingMore, fetchPage]);

  // Infinite scroll.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoadingMore && !isLoading) loadMore();
      },
      { root: null, rootMargin: '100px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isLoading, loadMore]);

  const handleMovieClick = useCallback(
    (activity: Activity) => {
      openMovie({
        id: `activity_${activity.id}`,
        title: activity.movieTitle,
        year: activity.movieYear || '',
        posterUrl: activity.moviePosterUrl || '/placeholder-poster.png',
        posterHint: `${activity.movieTitle} movie poster`,
        addedBy: activity.userId,
        status: 'To Watch',
        mediaType: activity.mediaType,
        tmdbId: activity.tmdbId,
      });
    },
    [openMovie],
  );

  const handlePostDeleted = useCallback((postId: string) => {
    setItems((prev) =>
      prev.filter((it) => !(it.kind === 'post' && it.post.id === postId)),
    );
    // Bust the cached feed snapshot(s) too, or the deleted post resurrects from
    // cache on the next remount within the freshness window. Prefix covers every
    // filter (all/friends share one /home-feed fetch, cached per filter key).
    if (currentUserId) invalidateCachedActionsByPrefix(`home-feed:${currentUserId}`);
  }, [currentUserId]);

  // Filter — block always; mute on all/friends; friends narrows to follows.
  const visibleItems = useMemo(() => {
    let list = items;
    if (feedFilter === 'friends') {
      const set = new Set(followingIds ?? []);
      list = list.filter((it) => set.has(feedItemAuthor(it)));
    }
    list = list.filter((it) => !isBlocked(feedItemAuthor(it)));
    if (feedFilter !== 'saved') {
      list = list.filter((it) => !isMuted(feedItemAuthor(it)));
    }
    return list;
  }, [items, feedFilter, followingIds, isMuted, isBlocked]);

  // Hot-takes are a GLOBAL pool — filter to the viewer (block + mute + not
  // self), mirroring the feed's own filtering above.
  const visibleHotTakes = useMemo(
    () =>
      hotTakes.filter(
        (t) =>
          t.author.uid !== currentUserId &&
          !isBlocked(t.author.uid) &&
          !isMuted(t.author.uid),
      ),
    [hotTakes, currentUserId, isBlocked, isMuted],
  );

  // Interleave recommendations + friends-watching (only in the `all` view).
  // The first recommendation lands within the first scroll — by card 3, or at
  // the end of a short feed so sparse feeds still surface discovery; then
  // every 6. Friends-watching is staggered (first at 6, then every 9) so two
  // non-friend cards never sit back-to-back.
  const feedNodes = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];
    let recIdx = 0;
    let fwIdx = 0;
    let htIdx = 0;
    const total = visibleItems.length;
    const firstRecAt = Math.min(3, total);
    const firstFwAt = Math.min(6, total);
    visibleItems.forEach((item, i) => {
      // Hot-take "green quote card" — leads the reel, then every 8 (for-you
      // only). Pushed BEFORE the item so the first one heads the stream, per
      // the design.
      if (feedFilter === 'all' && htIdx < visibleHotTakes.length && i % 8 === 0) {
        nodes.push(
          <HotTakeCard key={`ht_${visibleHotTakes[htIdx].reviewId}`} take={visibleHotTakes[htIdx]} />,
        );
        htIdx++;
      }
      if (item.kind === 'post') {
        nodes.push(
          <PostCard
            key={feedItemId(item)}
            post={item.post}
            currentUserId={currentUserId}
            onDeleted={handlePostDeleted}
          />,
        );
      } else {
        nodes.push(
          <ActivityCard
            key={feedItemId(item)}
            activity={item.activity}
            currentUserId={currentUserId}
            onMovieClick={handleMovieClick}
          />,
        );
      }
      if (feedFilter !== 'all') return;
      const pos = i + 1;
      if (
        recIdx < recSets.length &&
        (pos === firstRecAt || (pos > firstRecAt && (pos - firstRecAt) % 6 === 0))
      ) {
        nodes.push(
          <RecommendationCard key={`rec_${recSets[recIdx].basisTmdbId}`} set={recSets[recIdx]} />,
        );
        recIdx++;
      }
      if (
        fwIdx < fwCards.length &&
        (pos === firstFwAt || (pos > firstFwAt && (pos - firstFwAt) % 9 === 0))
      ) {
        nodes.push(
          <div key={`fw_${fwCards[fwIdx].tmdbId}`} className="py-5">
            <FriendsWatchingCard card={fwCards[fwIdx]} />
          </div>,
        );
        fwIdx++;
      }
    });
    return nodes;
  }, [visibleItems, recSets, fwCards, visibleHotTakes, feedFilter, currentUserId, handleMovieClick, handlePostDeleted]);

  return (
    <section>
      {isLoading ? (
        <FeedSkeleton />
      ) : error ? (
        <p className="text-sm text-muted-foreground py-4">{error}</p>
      ) : visibleItems.length === 0 ? (
        <>
          <EmptyState feedFilter={feedFilter} />
          {/* An empty feed → still offer discovery the moment it matters most:
              the global hot-take pool, then loved-film recommendations. Both
              are for-you-only and already block/mute/self-filtered. */}
          {feedFilter === 'all' && visibleHotTakes.length > 0 && (
            <div className="mt-2">
              <HotTakeCard take={visibleHotTakes[0]} />
            </div>
          )}
          {feedFilter === 'all' && recSets.length > 0 && (
            <div className="space-y-4 mt-2">
              {recSets.map((set) => (
                <RecommendationCard key={`rec_${set.basisTmdbId}`} set={set} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="divide-y divide-hair">{feedNodes}</div>
          <div ref={sentinelRef} className="h-1" />
          {isLoadingMore && <LoadingMore />}
          {!hasMore && visibleItems.length > 0 && <EndOfFeed />}
        </>
      )}

    </section>
  );
}
