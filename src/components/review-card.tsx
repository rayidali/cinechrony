'use client';

import { useState, memo, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { Heart, MoreVertical, Trash2, Pencil, Star } from 'lucide-react';
import { getRatingStyle } from '@/lib/utils';
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
import { likeReview, unlikeReview, deleteReview } from '@/app/actions';
import type { Review } from '@/lib/types';

/**
 * Render text with @mentions as clickable profile links.
 * Zero network calls - just parses and renders.
 */
function renderTextWithMentions(text: string): React.ReactNode {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // Add the mention as a link
    const username = match[1];
    parts.push(
      <Link
        key={`${match.index}-${username}`}
        href={`/profile/${username.toLowerCase()}`}
        className="text-primary font-medium hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        @{username}
      </Link>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last mention
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

interface ReviewCardProps {
  review: Review;
  currentUserId?: string;
  onDelete?: (reviewId: string) => void;
  onEdit?: (review: Review) => void;
  onReply?: (review: Review) => void;
  isReply?: boolean; // If true, this is a reply (renders more compact, no reply button)
}

export const ReviewCard = memo(function ReviewCard({ review, currentUserId, onDelete, onEdit, onReply, isReply = false }: ReviewCardProps) {
  const { toast } = useToast();
  const [likes, setLikes] = useState(review.likes);
  const [isLiked, setIsLiked] = useState(
    currentUserId ? review.likedBy.includes(currentUserId) : false
  );
  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOwner = currentUserId === review.userId;
  const displayName = review.userDisplayName || review.username || 'Anonymous';
  const timeAgo = formatDistanceToNow(new Date(review.createdAt), { addSuffix: true });
  const replyCount = review.replyCount || 0;

  // Get styles for the rating badge (using inline styles for consistency)
  const ratingStyle = useMemo(() => getRatingStyle(review.ratingAtTime), [review.ratingAtTime]);

  const handleLikeToggle = async () => {
    if (!currentUserId || isLiking) return;

    setIsLiking(true);
    try {
      if (isLiked) {
        const result = await unlikeReview(currentUserId, review.id);
        if (result.success) {
          setLikes(result.likes ?? likes - 1);
          setIsLiked(false);
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
      } else {
        const result = await likeReview(currentUserId, review.id);
        if (result.success) {
          setLikes(result.likes ?? likes + 1);
          setIsLiked(true);
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update like.' });
    } finally {
      setIsLiking(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUserId || isDeleting) return;

    setIsDeleting(true);
    try {
      const result = await deleteReview(currentUserId, review.id);
      if (result.success) {
        toast({ title: 'Deleted', description: 'Your review has been deleted.' });
        onDelete?.(review.id);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete review.' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`flex gap-3 ${isReply ? 'py-2' : 'py-4'}`}>
      {/* User avatar */}
      <Link href={`/profile/${review.username || ''}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={review.userPhotoUrl}
          displayName={review.userDisplayName}
          username={review.username}
          size={isReply ? 'sm' : 'md'}
        />
      </Link>

      {/* Review content */}
      <div className="flex-1 min-w-0">
        {/* Header: username, rating, timestamp */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/profile/${review.username || ''}`}
            className="font-bold text-sm hover:underline"
          >
            {displayName}
          </Link>

          {/* Rating badge - shows the rating at time of comment */}
          {review.ratingAtTime !== null && review.ratingAtTime !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold"
              style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
            >
              <Star className="h-3 w-3" style={{ fill: 'currentColor' }} />
              {review.ratingAtTime.toFixed(1)}
            </span>
          )}

          <span className="text-muted-foreground text-xs">
            reviewed {timeAgo}
          </span>

          {/* Options menu for owner */}
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-[2px] border-border rounded-xl">
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Review text with @mentions as links */}
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">
          {renderTextWithMentions(review.text)}
        </p>

        {/* Actions: like, reply */}
        <div className="flex items-center gap-4 mt-2">
          <button
            onClick={handleLikeToggle}
            disabled={!currentUserId || isLiking}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Heart
              className={`h-4 w-4 ${isLiked ? 'fill-red-500 text-red-500' : ''}`}
            />
            {likes > 0 && <span>{likes}</span>}
          </button>

          {/* Reply button - shows on all comments (Instagram/TikTok style) */}
          {onReply && (
            <button
              onClick={() => onReply(review)}
              disabled={!currentUserId}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Reply{!isReply && replyCount > 0 && ` (${replyCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
