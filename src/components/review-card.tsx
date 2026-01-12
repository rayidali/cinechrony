'use client';

import { useState, memo } from 'react';
import Link from 'next/link';
import { Heart, MoreVertical, Trash2, Pencil, Star } from 'lucide-react';
import { getRatingBgColor } from '@/lib/utils';
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

interface ReviewCardProps {
  review: Review;
  currentUserId?: string;
  onDelete?: (reviewId: string) => void;
  onEdit?: (review: Review) => void;
}

export const ReviewCard = memo(function ReviewCard({ review, currentUserId, onDelete, onEdit }: ReviewCardProps) {
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
    <div className="flex gap-3 py-4">
      {/* User avatar */}
      <Link href={`/profile/${review.username || ''}`} className="flex-shrink-0">
        <ProfileAvatar
          photoURL={review.userPhotoUrl}
          displayName={review.userDisplayName}
          username={review.username}
          size="md"
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
            <span className={`inline-flex items-center gap-0.5 ${getRatingBgColor(review.ratingAtTime)} text-white px-1.5 py-0.5 rounded text-xs font-bold`}>
              <Star className="h-3 w-3 fill-white" />
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

        {/* Review text */}
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">
          {review.text}
        </p>

        {/* Actions: like, comment (future) */}
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

          {/* Comment button - placeholder for future */}
          {/* <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <MessageCircle className="h-4 w-4" />
          </button> */}
        </div>
      </div>
    </div>
  );
});
