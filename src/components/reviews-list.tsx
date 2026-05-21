'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ReviewCard } from '@/components/review-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import { getMovieReviews } from '@/app/actions';
import { getRatingStyle } from '@/lib/utils';
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

/**
 * Reviews list — design system v2 "editorial discussion".
 * The most-liked review is lifted out as a magazine pull-quote at the top;
 * the rest follow, sorted. Letters-to-the-editor, not a Twitter timeline.
 */
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
      const isUpdate = (pendingNewComment as Review & { _isUpdate?: boolean })._isUpdate;

      if (isUpdate) {
        setReviews((prev) =>
          prev.map((r) => (r.id === pendingNewComment.id ? { ...pendingNewComment, _isUpdate: undefined } : r))
        );
      } else {
        setReviews((prev) => [pendingNewComment, ...prev]);
      }

      onPendingCommentHandled?.();
    }
  }, [pendingNewComment, onPendingCommentHandled]);

  const deleteReview = (reviewId: string) => {
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  };

  // Featured = the single most-liked review (only worth lifting out if it has
  // real traction and there's more than one review to choose from).
  const featured = useMemo(() => {
    if (reviews.length < 2) return null;
    const top = [...reviews].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    return top && (top.likes || 0) > 0 ? top : null;
  }, [reviews]);

  const restReviews = featured ? reviews.filter((r) => r.id !== featured.id) : reviews;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Sticky context header — tiny poster + title + tabular meta */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border flex-shrink-0">
        {moviePosterUrl && (
          <Image
            src={moviePosterUrl}
            alt={movieTitle}
            width={32}
            height={48}
            className="rounded-[5px] border border-border object-cover flex-shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
            {movieTitle}
          </h3>
          <p className="cc-meta text-[11px] text-muted-foreground">
            {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </div>

      {/* Scrollable middle */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-12 text-center">
            <div className="cc-eyebrow">reviews</div>
            <p className="font-serif italic text-[15px] text-muted-foreground mt-3">
              no reviews yet. be the first to write something.
            </p>
          </div>
        ) : (
          <>
            {/* Sort line */}
            <div className="flex items-baseline justify-between py-3">
              <span className="cc-eyebrow">reviews</span>
              <div className="flex gap-3 cc-meta text-[11px]">
                <button
                  onClick={() => setSortBy('recent')}
                  className={
                    sortBy === 'recent'
                      ? 'text-foreground border-b border-primary pb-0.5'
                      : 'text-muted-foreground hover:text-foreground'
                  }
                >
                  most recent
                </button>
                <button
                  onClick={() => setSortBy('likes')}
                  className={
                    sortBy === 'likes'
                      ? 'text-foreground border-b border-primary pb-0.5'
                      : 'text-muted-foreground hover:text-foreground'
                  }
                >
                  most liked
                </button>
              </div>
            </div>

            {/* Featured pull-quote */}
            {featured && (
              <div className="pb-5 mb-1">
                <div className="cc-eyebrow text-primary">★ featured review</div>
                <p className="font-serif italic font-light text-[21px] leading-snug text-foreground mt-3">
                  &ldquo;{featured.text}&rdquo;
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <ProfileAvatar
                    photoURL={featured.userPhotoUrl ?? null}
                    displayName={featured.userDisplayName ?? null}
                    username={featured.username}
                    size="sm"
                  />
                  <span className="cc-meta text-[11px] text-muted-foreground">
                    {featured.username ? `@${featured.username}` : 'anonymous'}
                    {featured.createdAt
                      ? ` · ${formatDistanceToNow(new Date(featured.createdAt), { addSuffix: true })}`
                      : ''}
                  </span>
                  {featured.ratingAtTime != null && (
                    <span
                      className="px-1.5 py-0.5 rounded font-headline font-bold text-[11px] tabular-nums"
                      style={{
                        ...getRatingStyle(featured.ratingAtTime).background,
                        ...getRatingStyle(featured.ratingAtTime).textOnBg,
                      }}
                    >
                      {featured.ratingAtTime.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* The rest */}
            <div className="divide-y divide-border">
              {restReviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  currentUserId={currentUserId}
                  onDelete={deleteReview}
                  onEdit={onRequestEditComment}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Composer trigger — iOS Safari safe (opens FullscreenTextInput) */}
      {currentUserId && onRequestAddComment && (
        <div className="px-4 py-3 border-t border-border bg-background flex-shrink-0">
          <button
            onClick={onRequestAddComment}
            className="w-full flex items-center px-4 h-11 rounded-full bg-background border border-input hover:border-foreground/30 transition-colors"
          >
            <span className="font-serif italic text-muted-foreground text-left flex-1 text-sm">
              share what you thought…
            </span>
          </button>
        </div>
      )}
    </div>
  );
});
