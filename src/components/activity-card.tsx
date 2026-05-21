'use client';

import { memo, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Heart, MessageCircle, Clock, Star, Eye, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Activity } from '@/lib/types';
import { likeActivity, unlikeActivity } from '@/app/actions';
import { useAuth } from '@/firebase';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { cn, getRatingStyle } from '@/lib/utils';

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w342';

type ActivityCardProps = {
  activity: Activity;
  currentUserId: string | null;
  onMovieClick?: (activity: Activity) => void;
};

// Get action text based on activity type
function getActionText(activity: Activity): string {
  switch (activity.type) {
    case 'added':
      return activity.listName ? `added to ${activity.listName}` : 'added to watchlist';
    case 'rated':
      return 'rated';
    case 'watched':
      return 'watched';
    case 'reviewed':
      return 'reviewed';
    default:
      return '';
  }
}

// Get icon for activity type
function ActivityIcon({ type }: { type: Activity['type'] }) {
  switch (type) {
    case 'added':
      return <Plus className="h-3 w-3" strokeWidth={1.8} />;
    case 'rated':
      return <Star className="h-3 w-3" strokeWidth={1.8} />;
    case 'watched':
      return <Eye className="h-3 w-3" strokeWidth={1.8} />;
    case 'reviewed':
      return <MessageCircle className="h-3 w-3" strokeWidth={1.8} />;
    default:
      return null;
  }
}

// Activity type badge — v2: lowercase mono in a hairline pill
function ActivityBadge({ type }: { type: Activity['type'] }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground">
      <ActivityIcon type={type} />
      {type}
    </span>
  );
}

export const ActivityCard = memo(function ActivityCard({
  activity,
  currentUserId,
  onMovieClick,
}: ActivityCardProps) {
  const auth = useAuth();
  const [isLiked, setIsLiked] = useState(
    currentUserId ? activity.likedBy?.includes(currentUserId) : false
  );
  const [likeCount, setLikeCount] = useState(activity.likes || 0);
  const [isPending, startTransition] = useTransition();

  const posterUrl = activity.moviePosterUrl || '/placeholder-poster.png';
  // AUDIT.md 2.3b: prefer live profile fields; fall back to the denormalized
  // snapshot captured at write time. Username is immutable (2.3a) so no
  // override needed for the profile URL.
  const live = useUserProfile(activity.userId);
  const liveDisplayName = live?.displayName ?? activity.displayName ?? null;
  const livePhotoURL    = live?.photoURL    ?? activity.photoURL    ?? null;
  const displayName = activity.username || liveDisplayName || 'Someone';
  const profileUrl = activity.username ? `/profile/${activity.username}` : '#';

  const handleLike = () => {
    if (!currentUserId || isPending) return;

    // Optimistic update
    const newIsLiked = !isLiked;
    setIsLiked(newIsLiked);
    setLikeCount((prev) => (newIsLiked ? prev + 1 : prev - 1));

    startTransition(async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken() ?? '';
        if (newIsLiked) {
          await likeActivity(idToken, activity.id);
        } else {
          await unlikeActivity(idToken, activity.id);
        }
      } catch (error) {
        // Revert on error
        setIsLiked(!newIsLiked);
        setLikeCount((prev) => (newIsLiked ? prev - 1 : prev + 1));
      }
    });
  };

  const handleMovieClick = () => {
    onMovieClick?.(activity);
  };

  // Format timestamp
  const timeAgo = activity.createdAt
    ? formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })
    : '';

  return (
    <div className="bg-card rounded-[20px] border border-border p-4 shadow-lift">
      {/* Header: Avatar, name, action, time */}
      <div className="flex items-start gap-3 mb-3">
        {/* User avatar */}
        <Link href={profileUrl} className="flex-shrink-0">
          {livePhotoURL ? (
            <Image
              src={livePhotoURL}
              alt={displayName}
              width={40}
              height={40}
              className="rounded-full border border-border"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center border border-border">
              <span className="text-sm font-bold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </Link>

        {/* Action text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={profileUrl}
              className="font-headline font-bold text-sm hover:underline truncate"
            >
              {displayName}
            </Link>
            <ActivityBadge type={activity.type} />
          </div>
          <p className="cc-meta text-[11px] text-muted-foreground mt-0.5">
            {getActionText(activity)} · {timeAgo}
          </p>
        </div>

        {/* Rating badge for 'rated' type */}
        {activity.type === 'rated' && activity.rating && (
          <div
            className="flex-shrink-0 px-2.5 py-1 rounded-lg font-bold text-sm"
            style={getRatingStyle(activity.rating).background}
          >
            <span style={getRatingStyle(activity.rating).textOnBg}>
              {activity.rating.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Movie info - clickable */}
      <button
        onClick={handleMovieClick}
        className="w-full text-left group"
      >
        <div className="flex gap-3">
          {/* Poster */}
          <div className="flex-shrink-0 w-16 aspect-[2/3] rounded-lg overflow-hidden border border-border relative">
            <Image
              src={posterUrl}
              alt={activity.movieTitle}
              fill
              className="object-cover group-hover:scale-105 transition-transform"
              sizes="64px"
            />
          </div>

          {/* Title and details */}
          <div className="flex-1 min-w-0 py-1">
            <h3 className="font-headline font-semibold text-[15px] lowercase tracking-tight line-clamp-2 group-hover:text-primary transition-colors">
              {activity.movieTitle}
            </h3>
            {activity.movieYear && (
              <p className="cc-meta text-xs text-muted-foreground mt-0.5">
                {activity.movieYear}
              </p>
            )}
            {/* Review preview for 'reviewed' type */}
            {activity.type === 'reviewed' && activity.reviewText && (
              <p className="font-serif italic text-[15px] text-muted-foreground mt-2 line-clamp-2">
                "{activity.reviewText}"
              </p>
            )}
          </div>
        </div>
      </button>

      {/* Footer: Like button */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
        <button
          onClick={handleLike}
          disabled={!currentUserId || isPending}
          className={cn(
            'flex items-center gap-1.5 text-sm transition-colors',
            isLiked
              ? 'text-red-500'
              : 'text-muted-foreground hover:text-red-500',
            (!currentUserId || isPending) && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Heart
            className={cn('h-4 w-4', isLiked && 'fill-current')}
          />
          <span>{likeCount > 0 ? likeCount : ''}</span>
        </button>

        {/* Time icon for mobile (shows relative time again) */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
          <Clock className="h-3.5 w-3.5" />
          <span>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
});
