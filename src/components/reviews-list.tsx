'use client';

import { useState, useEffect, memo, useCallback } from 'react';
import Image from 'next/image';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { ReviewCard } from '@/components/review-card';
import { getMovieReviews } from '@/app/actions';
import type { Review } from '@/lib/types';

interface ReviewsListProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  currentUserId?: string;
  // Callbacks for fullscreen editor (iOS Safari safe)
  onRequestAddComment?: () => void;
  onRequestEditComment?: (review: Review) => void;
  // Optimistic update - parent passes new/updated comment after save
  pendingNewComment?: Review | null;
  onPendingCommentHandled?: () => void;
}

export const ReviewsList = memo(function ReviewsList({
  tmdbId,
  mediaType,
  movieTitle,
  moviePosterUrl,
  currentUserId,
  onRequestAddComment,
  onRequestEditComment,
  pendingNewComment,
  onPendingCommentHandled,
}: ReviewsListProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'recent' | 'likes'>('recent');

  useEffect(() => {
    let cancelled = false;

    async function fetchReviews() {
      setIsLoading(true);
      try {
        const result = await getMovieReviews(tmdbId, sortBy);
        if (!cancelled && result.reviews) {
          setReviews(result.reviews as Review[]);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch reviews:', error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchReviews();

    return () => {
      cancelled = true;
    };
  }, [tmdbId, sortBy]);

  // Handle pending new/updated comment from fullscreen editor
  useEffect(() => {
    if (pendingNewComment) {
      // Check if this is an update (has _isUpdate flag) or new comment
      const isUpdate = (pendingNewComment as Review & { _isUpdate?: boolean })._isUpdate;

      if (isUpdate) {
        // Update existing review in list
        setReviews((prev) =>
          prev.map((r) => (r.id === pendingNewComment.id ? { ...pendingNewComment, _isUpdate: undefined } : r))
        );
      } else {
        // Add new review to top of list
        setReviews((prev) => [pendingNewComment, ...prev]);
      }

      // Notify parent that we've handled the pending comment
      onPendingCommentHandled?.();
    }
  }, [pendingNewComment, onPendingCommentHandled]);

  const deleteReview = (reviewId: string) => {
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Movie info header with poster */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        {moviePosterUrl && (
          <Image
            src={moviePosterUrl}
            alt={movieTitle}
            width={48}
            height={72}
            className="rounded border border-border object-cover flex-shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate">{movieTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {reviews.length} {reviews.length === 1 ? 'comment' : 'comments'}
          </p>
        </div>
      </div>

      {/* Sort options */}
      {reviews.length > 1 && (
        <div className="px-4 py-2 flex gap-2 border-b border-border flex-shrink-0">
          <button
            onClick={() => setSortBy('recent')}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              sortBy === 'recent'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => setSortBy('likes')}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              sortBy === 'likes'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            Top
          </button>
        </div>
      )}

      {/* Reviews list - scrollable middle section */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No comments yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Be the first to share your thoughts!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                currentUserId={currentUserId}
                onDelete={deleteReview}
                onEdit={onRequestEditComment}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tap to add comment button - iOS Safari safe (no inline textarea) */}
      {currentUserId && onRequestAddComment && (
        <div className="px-4 py-3 border-t border-border bg-background flex-shrink-0">
          <button
            onClick={onRequestAddComment}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-secondary/50 hover:bg-secondary/70 active:bg-secondary transition-colors border border-border/50"
          >
            <Send className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground text-left flex-1">Add a comment...</span>
          </button>
        </div>
      )}
    </div>
  );
});
