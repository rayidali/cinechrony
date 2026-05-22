'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Loader2, Film, Users } from 'lucide-react';
import Link from 'next/link';
import { getActivityFeed } from '@/app/actions';
import type { Activity, Movie } from '@/lib/types';
import { ActivityCard } from './activity-card';
import { PublicMovieDetailsModal } from './public-movie-details-modal';

type ActivityFeedProps = {
  currentUserId: string | null;
  refreshKey?: number; // Increment to trigger refresh
  /** `friends` narrows the feed to people the viewer follows. */
  feedFilter?: 'all' | 'friends';
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
function EmptyState({ feedFilter }: { feedFilter: 'all' | 'friends' }) {
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
  const [activities, setActivities] = useState<Activity[]>([]);
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

  // Load initial feed (and refresh when refreshKey changes)
  useEffect(() => {
    async function loadFeed() {
      try {
        setIsLoading(true);
        setError(null);
        const result = await getActivityFeed();
        if (result.error) {
          setError(result.error);
        } else {
          setActivities(result.activities);
          setHasMore(result.hasMore);
          setCursor(result.nextCursor || null);
        }
      } catch (err) {
        setError('Failed to load activity feed');
      } finally {
        setIsLoading(false);
      }
    }

    loadFeed();
  }, [refreshKey]);

  // Load more function
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !cursor) return;

    try {
      setIsLoadingMore(true);
      const result = await getActivityFeed(cursor);
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
  }, [cursor, hasMore, isLoadingMore]);

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
    if (feedFilter !== 'friends') return activities;
    const set = new Set(followingIds ?? []);
    return activities.filter((a) => set.has(a.userId));
  }, [activities, feedFilter, followingIds]);

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
          <div className="space-y-4">
            {visibleActivities.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                currentUserId={currentUserId}
                onMovieClick={handleMovieClick}
              />
            ))}
          </div>

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
