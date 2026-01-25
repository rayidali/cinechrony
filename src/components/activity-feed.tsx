'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Sparkles, Loader2, Film, Plus } from 'lucide-react';
import Link from 'next/link';
import { getActivityFeed } from '@/app/actions';
import type { Activity, Movie } from '@/lib/types';
import { ActivityCard } from './activity-card';
import { PublicMovieDetailsModal } from './public-movie-details-modal';

type ActivityFeedProps = {
  currentUserId: string | null;
  refreshKey?: number; // Increment to trigger refresh
};

// Skeleton loader for initial load
function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-card rounded-2xl border-[3px] dark:border-2 border-border p-4 shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none"
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

// Enhanced empty state
function EmptyState() {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
        <Film className="h-10 w-10 text-primary" />
      </div>
      <h3 className="font-headline font-bold text-xl mb-2">No activity yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">
        Be the first to add a movie, rate something, or write a review. Your activity will show up here!
      </p>
      <Link
        href="/add"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-medium text-sm shadow-[3px_3px_0px_0px_hsl(var(--border))] dark:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_hsl(var(--border))] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
      >
        <Plus className="h-4 w-4" />
        Add your first movie
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

export function ActivityFeed({ currentUserId, refreshKey = 0 }: ActivityFeedProps) {
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

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-headline font-bold">Activity</h2>
      </div>

      {isLoading ? (
        <ActivitySkeleton />
      ) : error ? (
        <p className="text-sm text-muted-foreground py-4">{error}</p>
      ) : activities.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="space-y-4">
            {activities.map((activity) => (
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
          {!hasMore && activities.length > 0 && <EndOfFeed />}
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
