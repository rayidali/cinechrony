'use client';

import { useState, memo, useMemo } from 'react';
import { Link } from '@/lib/native-nav';
import {
  Heart,
  MoreHorizontal,
  Trash2,
  Pencil,
  Flag,
  EyeOff,
} from 'lucide-react';
import { cn, getRatingStyle } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/firebase';
import { useUserProfile } from '@/contexts/user-profile-cache';
import type { Review } from '@/lib/types';

/**
 * Render text with @mentions as clickable film-red profile links — no
 * network calls, just a regex split.
 */
function renderTextWithMentions(text: string): React.ReactNode {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const username = match[1];
    parts.push(
      <Link
        key={`${match.index}-${username}`}
        href={`/profile/${username.toLowerCase()}`}
        className="text-primary font-medium hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        @{username}
      </Link>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

interface ReviewCardProps {
  review: Review;
  currentUserId?: string;
  onDelete?: (reviewId: string) => void;
  onEdit?: (review: Review) => void;
  onReply?: (review: Review) => void;
  /** True for reply rows — 36px indent, 22px avatar (1 level deep max). */
  isReply?: boolean;
}

/**
 * Review row — v3 ("consistent fonts, clear hierarchy").
 *
 * 3-column layout per `pattern-comments.html`: avatar (left, 32 / 22 px) —
 * body (flex, byline + text + actions) — vertical heart column (right,
 * count below). Hairline dividers between rows, no boxes. Replies get a
 * 36px indent and a smaller avatar (1 level deep — matches production).
 * Author-flagged spoilers shield the body behind a "tap to reveal" block.
 */
export const ReviewCard = memo(function ReviewCard({
  review,
  currentUserId,
  onDelete,
  onEdit,
  onReply,
  isReply = false,
}: ReviewCardProps) {
  const { toast } = useToast();
  const auth = useAuth();
  const [likes, setLikes] = useState(review.likes);
  const [isLiked, setIsLiked] = useState(
    currentUserId ? review.likedBy.includes(currentUserId) : false,
  );
  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // v3: spoiler shield — body is hidden until the viewer taps.
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);

  const isOwner = currentUserId === review.userId;
  // AUDIT.md 2.3b: prefer live display name / photo from the cache, fall
  // back to the denormalized snapshot stamped onto the review at write time.
  const live = useUserProfile(review.userId);
  const liveDisplayName = live?.displayName ?? review.userDisplayName ?? null;
  const livePhotoUrl = live?.photoURL ?? review.userPhotoUrl ?? null;
  const displayName = liveDisplayName || review.username || 'anonymous';
  const timeAgo = formatDistanceToNow(new Date(review.createdAt), {
    addSuffix: false,
  });
  const replyCount = review.replyCount || 0;

  const ratingStyle = useMemo(
    () => getRatingStyle(review.ratingAtTime),
    [review.ratingAtTime],
  );

  const handleLikeToggle = async () => {
    if (!currentUserId || isLiking) return;
    setIsLiking(true);
    try {
      if (isLiked) {
        const result = await apiCall<{ likes: number }>(
          'DELETE',
          `/api/v1/reviews/${review.id}/like`,
        );
        setLikes(result.likes ?? likes - 1);
        setIsLiked(false);
      } else {
        const result = await apiCall<{ likes: number }>(
          'POST',
          `/api/v1/reviews/${review.id}/like`,
        );
        setLikes(result.likes ?? likes + 1);
        setIsLiked(true);
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to update like.',
      });
    } finally {
      setIsLiking(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUserId || isDeleting) return;
    setIsDeleting(true);
    try {
      await apiCall('DELETE', `/api/v1/reviews/${review.id}`);
      toast({ title: 'deleted.', description: 'your review has been deleted.' });
      onDelete?.(review.id);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Failed to delete review.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReport = async () => {
    try {
      await apiCall('POST', '/api/v1/reports', {
        contentType: 'review',
        targetId: review.id,
        reason: '',
      });
      toast({ title: 'reported.', description: "thanks — we'll review this." });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof ApiClientError ? err.message : 'Could not submit report.',
      });
    }
  };

  const showShield = !!review.hasSpoiler && !spoilerRevealed;

  return (
    <div
      className={cn(
        'flex gap-3 border-t border-border',
        isReply ? 'pl-[36px] py-2.5' : 'py-3.5',
      )}
    >
      {/* Avatar */}
      <Link href={`/profile/${review.username || ''}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={livePhotoUrl}
          displayName={liveDisplayName}
          username={review.username}
          size={isReply ? 'xs' : 'sm'}
        />
      </Link>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Byline — name · @handle · time · ⋯  | rating chip on the right edge */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <Link
            href={`/profile/${review.username || ''}`}
            className="font-headline font-bold text-[13px] tracking-[-0.01em] text-foreground hover:underline"
          >
            {displayName}
          </Link>
          {review.username && (
            <>
              <span className="cc-meta text-[10px] text-muted-foreground">
                @{review.username}
              </span>
              <span className="cc-meta text-[10px] text-muted-foreground">·</span>
            </>
          )}
          <span className="cc-meta text-[10px] text-muted-foreground">
            {timeAgo}
          </span>
          {/* Rating chip — right-edge of the byline */}
          {review.ratingAtTime !== null && review.ratingAtTime !== undefined && (
            <span
              className="ml-auto px-1.5 py-0.5 rounded font-headline font-bold text-[11px] tabular-nums"
              style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
            >
              {review.ratingAtTime.toFixed(1)}
            </span>
          )}
          {/* Discreet overflow — sits after the rating chip if present */}
          {currentUserId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-6 w-6 text-muted-foreground/70',
                    review.ratingAtTime == null && 'ml-auto',
                  )}
                  aria-label="Comment options"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border border-border rounded-xl"
              >
                {isOwner ? (
                  <>
                    <DropdownMenuItem onClick={() => onEdit?.(review)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="text-destructive"
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={handleReport}>
                    <Flag className="h-4 w-4 mr-2" />
                    Report
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Body text — Newsreader 14/400 (not italic). Behind a spoiler
            shield when the author flagged it. */}
        {showShield ? (
          <button
            type="button"
            onClick={() => setSpoilerRevealed(true)}
            className="w-full mt-2 px-3.5 py-3 rounded-[10px] bg-card border border-dashed border-border text-center cc-meta text-[11px] text-muted-foreground active:opacity-70"
          >
            <EyeOff
              className="inline h-3 w-3 mr-1.5 align-text-bottom"
              strokeWidth={1.8}
            />
            tap to reveal — spoilers
          </button>
        ) : (
          <p
            className={cn(
              'font-serif text-[14px] leading-[1.45] whitespace-pre-wrap break-words',
              isReply ? 'mt-0.5 text-[13px]' : 'mt-1',
            )}
          >
            {renderTextWithMentions(review.text)}
          </p>
        )}

        {/* Actions — mono lowercase, subordinate to the like count */}
        <div className="flex items-center gap-4 mt-2 cc-meta text-[10px] text-muted-foreground">
          {onReply && (
            <button
              onClick={() => onReply(review)}
              disabled={!currentUserId}
              className="hover:text-foreground transition-colors disabled:opacity-50"
            >
              reply
            </button>
          )}
          {!isReply && replyCount > 0 && (
            <span className="text-muted-foreground/70">
              · {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </div>
      </div>

      {/* Heart column — vertical, count below the icon */}
      <button
        onClick={handleLikeToggle}
        disabled={!currentUserId || isLiking}
        aria-label={isLiked ? 'Unlike' : 'Like'}
        className={cn(
          'flex flex-col items-center gap-0.5 pt-0.5 disabled:opacity-50 transition-colors',
          isLiked ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Heart
          className={cn('h-4 w-4', isLiked && 'fill-current')}
          strokeWidth={1.8}
        />
        {likes > 0 && (
          <span className="cc-meta text-[9px] tabular-nums">{likes}</span>
        )}
      </button>
    </div>
  );
});
