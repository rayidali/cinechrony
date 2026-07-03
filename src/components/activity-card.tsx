'use client';

import { memo, useState, useTransition } from 'react';
import { tmdbImg } from '@/lib/tmdb-image';
import Image from 'next/image';
import { Link } from '@/lib/native-nav';
import { Heart, Star, Eye, Plus, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Activity } from '@/lib/types';
import { apiCall } from '@/lib/api-client';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { VerifiedBadge } from '@/components/verified-badge';
import { cn, getRatingStyle } from '@/lib/utils';
import { BookmarkButton } from './bookmark-button';
import { CardOverflowMenu } from './card-overflow-menu';

type ActivityCardProps = {
  activity: Activity;
  currentUserId: string | null;
  onMovieClick?: (activity: Activity) => void;
};

/** Lowercase verb for the activity pill. */
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

// Activity verb — v2: lowercase mono in a hairline pill.
function ActivityBadge({ type }: { type: Activity['type'] }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground">
      <ActivityIcon type={type} />
      {type}
    </span>
  );
}

/**
 * Activity card — design system v2 "editorial newsfeed".
 *
 * One event from one friend. The card is about your friend's behaviour, not a
 * transactional moment — no watch-now CTAs, no genre pills, no star rows.
 * Variant by type: added → list name (serif italic); rated → chip, no context;
 * watched → atomic; reviewed → review snippet as a magazine pull-quote.
 */
export const ActivityCard = memo(function ActivityCard({
  activity,
  currentUserId,
  onMovieClick,
}: ActivityCardProps) {
  const [isLiked, setIsLiked] = useState(
    currentUserId ? activity.likedBy?.includes(currentUserId) : false
  );
  const [likeCount, setLikeCount] = useState(activity.likes || 0);
  const [isPending, startTransition] = useTransition();

  const posterUrl = tmdbImg(activity.moviePosterUrl, 'w185') || '/placeholder-poster.png';
  // AUDIT.md 2.3b: prefer live profile fields; fall back to the denormalized
  // snapshot captured at write time.
  const live = useUserProfile(activity.userId);
  const liveDisplayName = live?.displayName ?? activity.displayName ?? null;
  const livePhotoURL = live?.photoURL ?? activity.photoURL ?? null;
  const handle = activity.username ? `@${activity.username}` : liveDisplayName || 'someone';
  const profileUrl = activity.username ? `/profile/${activity.username}` : '#';
  const avatarLetter = (activity.username || liveDisplayName || 'S').charAt(0).toUpperCase();

  const handleLike = () => {
    if (!currentUserId || isPending) return;
    const newIsLiked = !isLiked;
    setIsLiked(newIsLiked);
    setLikeCount((prev) => (newIsLiked ? prev + 1 : prev - 1));

    startTransition(async () => {
      try {
        if (newIsLiked) {
          await apiCall('POST', `/api/v1/activities/${activity.id}/like`);
        } else {
          await apiCall('DELETE', `/api/v1/activities/${activity.id}/like`);
        }
      } catch {
        setIsLiked(!newIsLiked);
        setLikeCount((prev) => (newIsLiked ? prev - 1 : prev + 1));
      }
    });
  };

  const handleMovieClick = () => onMovieClick?.(activity);

  const timeAgo = activity.createdAt
    ? formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })
    : '';

  return (
    <div className="py-5">
      {/* Row 1 — who · what · when */}
      <div className="flex items-center gap-[11px]">
        <Link href={profileUrl} aria-label={handle} className="flex-shrink-0">
          {livePhotoURL ? (
            <Image
              src={livePhotoURL}
              alt={handle}
              width={40}
              height={40}
              className="rounded-full object-cover w-10 h-10"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <span className="font-headline font-bold text-sm text-muted-foreground">{avatarLetter}</span>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={profileUrl}
              className="inline-flex items-center gap-1 font-ui font-bold text-[15px] text-foreground tracking-[-0.01em] hover:underline truncate"
            >
              {handle}
              <VerifiedBadge uid={activity.userId} />
            </Link>
            <ActivityBadge type={activity.type} />
          </div>
          <p className="cc-meta text-[10px] text-muted-foreground mt-0.5">{timeAgo}</p>
        </div>

        {/* rated → rating chip top-right, no context line */}
        {activity.type === 'rated' && activity.rating != null && (
          <span
            className="flex-shrink-0 px-1.5 py-0.5 rounded font-headline font-bold text-xs tabular-nums"
            style={{
              ...getRatingStyle(activity.rating).background,
              ...getRatingStyle(activity.rating).textOnBg,
            }}
          >
            {activity.rating.toFixed(1)}
          </span>
        )}

        <div className="flex-shrink-0">
          <CardOverflowMenu
            authorId={activity.userId}
            authorUsername={activity.username}
            itemType="activity"
            itemId={activity.id}
            movieTmdbId={activity.tmdbId}
            movieTitle={activity.movieTitle}
            mediaType={activity.mediaType}
          />
        </div>
      </div>

      {/* Row 2 — the movie */}
      <button onClick={handleMovieClick} className="w-full text-left group mt-3">
        <div className="flex gap-3 items-start">
          <div className="relative w-12 h-[72px] rounded-[10px] overflow-hidden bg-muted flex-shrink-0">
            <Image
              src={posterUrl}
              alt={activity.movieTitle}
              fill
              className="object-cover"
              sizes="48px"
            />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-headline font-semibold text-[15px] lowercase tracking-tight leading-tight line-clamp-2 group-hover:text-primary transition-colors">
              {activity.movieTitle}
            </h3>
            {activity.movieYear && (
              <p className="cc-meta text-[10px] text-muted-foreground mt-1">{activity.movieYear}</p>
            )}

            {/* reviewed → the review itself, as a film-red-ruled pull-quote */}
            {activity.type === 'reviewed' && activity.reviewText && (
              <p className="font-serif italic text-[14px] leading-snug text-foreground mt-2 pl-3 border-l-2 border-primary">
                {activity.reviewText}
              </p>
            )}

            {/* added → list name in serif italic */}
            {activity.type === 'added' && activity.listName && (
              <p className="font-serif italic text-[14px] text-muted-foreground mt-1.5">
                to {activity.listName}
              </p>
            )}
          </div>
        </div>
      </button>

      {/* Footer — like + save on the left, reply on the right. Borderless to
          match the PostCard footer: the reel's own divide-y draws the only
          rule between entries (no internal border-t). Touch targets sized for
          thumbs; icons 18px for legibility. */}
      <div className="flex items-center justify-between mt-3.5">
        <div className="flex items-center gap-1 -my-1">
          <button
            onClick={handleLike}
            disabled={!currentUserId || isPending}
            className={cn(
              'flex items-center gap-1.5 font-ui font-semibold text-[13px] h-10 px-2 rounded-full transition-colors active:scale-95',
              isLiked ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              (!currentUserId || isPending) && 'opacity-50 cursor-not-allowed'
            )}
            aria-label={isLiked ? 'Unlike' : 'Like'}
          >
            <Heart className={cn('h-[18px] w-[18px]', isLiked ? 'fill-primary text-primary' : '')} strokeWidth={1.9} />
            {likeCount > 0 && <span className="tabular-nums">{likeCount}</span>}
          </button>

          <BookmarkButton itemType="activity" itemId={activity.id} className="h-10 px-2 rounded-full" />
        </div>

        <button
          onClick={handleMovieClick}
          className="cc-meta text-[12px] h-10 px-3 -mr-2 rounded-full text-muted-foreground hover:text-foreground transition-colors active:scale-95"
        >
          reply →
        </button>
      </div>
    </div>
  );
});
