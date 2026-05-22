'use client';

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { Loader2, Film, Users, Bookmark } from 'lucide-react';
import Link from 'next/link';
import {
  getActivityFeed,
  getSavedFeed,
  getRecommendationsForUser,
  getFriendsWatching,
  type RecommendationSet,
  type FriendsWatchingCard as FWCard,
} from '@/app/actions';
import { useAuth } from '@/firebase';
import { useUserMutesCache } from '@/contexts/user-mutes-cache';
import type { Activity, Movie } from '@/lib/types';
import { ActivityCard } from './activity-card';
import { RecommendationCard } from './recommendation-card';
import { FriendsWatchingCard } from './friends-watching-card';
import { PublicMovieDetailsModal } from './public-movie-details-modal';

type ActivityFeedProps = {
  currentUserId: string | null;
  refreshKey?: number; // Increment to trigger refresh
  /** `friends` narrows to followed users; `saved` shows the bookmarks feed. */
  feedFilter?: 'all' | 'saved' | 'friends';
  /** UIDs the viewer follows — required for the `friends` filter. */
  followingIds?: string[];
};

// Skeleton loader for initial load
function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-card rounded-2xl border dark:border border-border p-4 shadow-lift"
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-4 bg-muted rounded animate-pulse w-24 mb-1" />
              <div className="h-3 bg-muted rounded animate-pulse w-16" />
            </div>
            <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
          </div>

          {/* Content */}
          <div className="flex gap-3">
            <div className="w-16 aspect-[2/3] rounded-lg bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-5 bg-muted rounded animate-pulse w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded animate-pulse w-1/4" />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
            <div className="h-4 w-12 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Loading indicator for infinite scroll
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
          ? 'your circle has been quiet. follow a few more people and the feed fills up.'
          : "the credits aren't rolling yet — follow some friends and the feed starts."}
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

// End of feed indicator
function EndOfFeed() {
  return (
    <div className="text-center py-6 text-sm text-muted-foreground">
      You're all caught up!
    </div>
  );
}

export function ActivityFeed({
  currentUserId,
  refreshKey = 0,
  feedFilter = 'all',
  followingIds,
}: ActivityFeedProps) {
  const auth = useAuth();
  const { isMuted } = useUserMutesCache();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [recSets, setRecSets] = useState<RecommendationSet[]>([]);
  const [fwCards, setFwCards] = useState<FWCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Ref for infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch one page — the `saved` filter reads the bookmarks feed instead.
  const fetchPage = useCallback(
    async (pageCursor?: string) => {
      if (feedFilter === 'saved') {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        return getSavedFeed(idToken, pageCursor);
      }
      return getActivityFeed(pageCursor);
    },
    [feedFilter, auth],
  );

  // Load initial feed (refresh on refreshKey; reload when the filter changes).
  useEffect(() => {
    let cancelled = false;
    async function loadFeed() {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchPage();
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          setActivities(result.activities);
          setHasMore(result.hasMore);
          setCursor(result.nextCursor || null);
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load activity feed');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadFeed();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, fetchPage]);

  // "for you" recommendations + friends-watching — interleaved into the feed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        if (!idToken) return;
        const [recs, fw] = await Promise.all([
          getRecommendationsForUser(idToken),
          getFriendsWatching(idToken),
        ]);
        if (cancelled) return;
        if ('sets' in recs) setRecSets(recs.sets ?? []);
        if ('cards' in fw) setFwCards(fw.cards ?? []);
      } catch {
        /* recommendations + friends-watching are non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, refreshKey]);

  // Load more function
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !cursor) return;

    try {
      setIsLoadingMore(true);
      const result = await fetchPage(cursor);
      if (result.error) {
        setError(result.error);
      } else {
        setActivities((prev) => [...prev, ...result.activities]);
        setHasMore(result.hasMore);
        setCursor(result.nextCursor || null);
      }
    } catch (err) {
      setError('Failed to load more activities');
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, hasMore, isLoadingMore, fetchPage]);

  // Infinite scroll with Intersection Observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isLoadingMore && !isLoading) {
          loadMore();
        }
      },
      {
        root: null, // viewport
        rootMargin: '100px', // trigger 100px before reaching bottom
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingMore, isLoading, loadMore]);

  // Handle movie click - open modal
  const handleMovieClick = useCallback((activity: Activity) => {
    const movieForModal: Movie = {
      id: `activity_${activity.id}`,
      title: activity.movieTitle,
      year: activity.movieYear || '',
      posterUrl: activity.moviePosterUrl || '/placeholder-poster.png',
      posterHint: `${activity.movieTitle} movie poster`,
      addedBy: activity.userId,
      status: 'To Watch',
      mediaType: activity.mediaType,
      tmdbId: activity.tmdbId,
    };

    setSelectedMovie(movieForModal);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedMovie(null);
  }, []);

  // `friends` narrows to followed users. A client-side filter over the global
  // feed for now — Phase 9 replaces this with a server-side merged feed query.
  const visibleActivities = useMemo(() => {
    let list = activities;
    if (feedFilter === 'friends') {
      const set = new Set(followingIds ?? []);
      list = list.filter((a) => set.has(a.userId));
    }
    // Muted authors drop out of `all` / `friends` (the `saved` archive is kept).
    if (feedFilter !== 'saved') {
      list = list.filter((a) => !isMuted(a.userId));
    }
    return list;
  }, [activities, feedFilter, followingIds, isMuted]);

  // Interleave recommendations + friends-watching — only in the `all` view;
  // `friends` stays a pure chronological friend feed, `saved` is the archive.
  const feedNodes = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];
    let recIdx = 0;
    let fwIdx = 0;
    visibleActivities.forEach((activity, i) => {
      nodes.push(
        <ActivityCard
          key={activity.id}
          activity={activity}
          currentUserId={currentUserId}
          onMovieClick={handleMovieClick}
        />,
      );
      if (feedFilter !== 'all') return;
      const pos = i + 1;
      // friends-watching after #3, then every 8 cards
      if ((pos === 3 || (pos > 3 && (pos - 3) % 8 === 0)) && fwIdx < fwCards.length) {
        nodes.push(
          <FriendsWatchingCard key={`fw_${fwCards[fwIdx].tmdbId}`} card={fwCards[fwIdx]} />,
        );
        fwIdx++;
      }
      // recommendations every 5 cards
      if (pos % 5 === 0 && recIdx < recSets.length) {
        nodes.push(
          <RecommendationCard key={`rec_${recSets[recIdx].basisTmdbId}`} set={recSets[recIdx]} />,
        );
        recIdx++;
      }
    });
    return nodes;
  }, [visibleActivities, recSets, fwCards, feedFilter, currentUserId, handleMovieClick]);

  return (
    <section>
      {isLoading ? (
        <ActivitySkeleton />
      ) : error ? (
        <p className="text-sm text-muted-foreground py-4">{error}</p>
      ) : visibleActivities.length === 0 ? (
        <EmptyState feedFilter={feedFilter} />
      ) : (
        <>
          <div className="space-y-4">{feedNodes}</div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />

          {/* Loading indicator */}
          {isLoadingMore && <LoadingMore />}

          {/* End of feed */}
          {!hasMore && visibleActivities.length > 0 && <EndOfFeed />}
        </>
      )}

      {/* Movie Details Modal */}
      <PublicMovieDetailsModal
        movie={selectedMovie}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </section>
  );
}
