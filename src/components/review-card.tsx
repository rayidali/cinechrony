'use client';

import { useState, memo, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { Heart, MoreVertical, Trash2, Pencil, Star, Flag } from 'lucide-react';
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
import { likeReview, unlikeReview, deleteReview, reportContent } from '@/app/actions';
import { useAuth } from '@/firebase';
import { useUserProfile } from '@/contexts/user-profile-cache';
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
  const auth = useAuth();
  const [likes, setLikes] = useState(review.likes);
  const [isLiked, setIsLiked] = useState(
    currentUserId ? review.likedBy.includes(currentUserId) : false
  );
  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOwner = currentUserId === review.userId;
  // AUDIT.md 2.3b: prefer live display name / photo from the cache, fall
  // back to the denormalized snapshot stamped onto the review at write time.
  const live = useUserProfile(review.userId);
  const liveDisplayName = live?.displayName ?? review.userDisplayName ?? null;
  const livePhotoUrl    = live?.photoURL    ?? review.userPhotoUrl    ?? null;
  const displayName = liveDisplayName || review.username || 'Anonymous';
  const timeAgo = formatDistanceToNow(new Date(review.createdAt), { addSuffix: true });
  const replyCount = review.replyCount || 0;

  // Get styles for the rating badge (using inline styles for consistency)
  const ratingStyle = useMemo(() => getRatingStyle(review.ratingAtTime), [review.ratingAtTime]);

  const handleLikeToggle = async () => {
    if (!currentUserId || isLiking) return;

    setIsLiking(true);
    try {
      if (isLiked) {
        const result = await unlikeReview(await auth.currentUser?.getIdToken() ?? '', review.id);
        if ('error' in result) {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        } else {
          setLikes(result.likes ?? likes - 1);
          setIsLiked(false);
        }
      } else {
        const result = await likeReview(await auth.currentUser?.getIdToken() ?? '', review.id);
        if ('error' in result) {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        } else {
          setLikes(result.likes ?? likes + 1);
          setIsLiked(true);
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
      const result = await deleteReview(await auth.currentUser?.getIdToken() ?? '', review.id);
      if ('error' in result) {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      } else {
        toast({ title: 'Deleted', description: 'Your review has been deleted.' });
        onDelete?.(review.id);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete review.' });
    } finally {
      setIsDeleting(false);
    }
  };

  // AUDIT.md (App Store §1.2): report this comment for moderator review.
  const handleReport = async () => {
    try {
      const res = await reportContent(
        await auth.currentUser?.getIdToken() ?? '',
        'review',
        review.id,
        '',
      );
      if ('error' in res) {
        toast({ variant: 'destructive', title: 'Error', description: res.error });
      } else {
        toast({ title: 'Reported', description: "Thanks — we'll review this." });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not submit report.' });
    }
  };

  return (
    <div className={`flex gap-3 ${isReply ? 'py-2' : 'py-4'}`}>
      {/* User avatar */}
      <Link href={`/profile/${review.username || ''}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={livePhotoUrl}
          displayName={liveDisplayName}
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

          {/* Options menu — owner gets Edit/Delete; everyone else gets Report
              (AUDIT.md App Store §1.2: UGC must be reportable). */}
          {currentUserId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border border-border rounded-xl">
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
