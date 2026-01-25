'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { getActivityFeed } from '@/app/actions';
import type { Activity, Movie } from '@/lib/types';
import { ActivityCard } from './activity-card';
import { PublicMovieDetailsModal } from './public-movie-details-modal';

type ActivityFeedProps = {
  currentUserId: string | null;
};

// Skeleton loader
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

// Empty state
function EmptyState() {
  return (
    <div className="text-center py-12">
      <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
      <h3 className="font-semibold text-lg mb-2">No activity yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        When people add movies, rate them, or write reviews, you'll see it here.
      </p>
    </div>
  );
}

export function ActivityFeed({ currentUserId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load initial feed
  useEffect(() => {
    async function loadFeed() {
      try {
        setIsLoading(true);
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
  }, []);

  // Load more
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

          {/* Load more button */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
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
