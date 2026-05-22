'use client';

import { memo, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Heart, Star, Eye, Plus, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Activity } from '@/lib/types';
import { likeActivity, unlikeActivity } from '@/app/actions';
import { useAuth } from '@/firebase';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { cn, getRatingStyle } from '@/lib/utils';
import { BookmarkButton } from './bookmark-button';

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
  const auth = useAuth();
  const [isLiked, setIsLiked] = useState(
    currentUserId ? activity.likedBy?.includes(currentUserId) : false
  );
  const [likeCount, setLikeCount] = useState(activity.likes || 0);
  const [isPending, startTransition] = useTransition();

  const posterUrl = activity.moviePosterUrl || '/placeholder-poster.png';
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
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        if (newIsLiked) {
          await likeActivity(idToken, activity.id);
        } else {
          await unlikeActivity(idToken, activity.id);
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
    <div className="bg-card rounded-[20px] border border-border p-4 shadow-lift">
      {/* Row 1 — who · what · when */}
      <div className="flex items-center gap-2.5">
        <Link href={profileUrl} className="flex-shrink-0">
          {livePhotoURL ? (
            <Image
              src={livePhotoURL}
              alt={handle}
              width={32}
              height={32}
              className="rounded-full border border-border object-cover w-8 h-8"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center border border-border">
              <span className="font-headline font-bold text-xs">{avatarLetter}</span>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={profileUrl}
              className="font-headline font-semibold text-sm tracking-tight hover:underline truncate"
            >
              {handle}
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
      </div>

      {/* Row 2 — the movie */}
      <button onClick={handleMovieClick} className="w-full text-left group mt-3">
        <div className="flex gap-3 items-start">
          <div className="flex-shrink-0 w-12 aspect-[2/3] rounded-lg overflow-hidden border border-border relative">
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

            {/* reviewed → review snippet as a magazine pull-quote */}
            {activity.type === 'reviewed' && activity.reviewText && (
              <p className="font-serif italic text-[14px] leading-snug text-foreground mt-2 pl-2.5 border-l border-border line-clamp-2">
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

      {/* Footer — like + save on the left, reply on the right */}
      <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-border">
        <div className="flex items-center gap-4">
          <button
            onClick={handleLike}
            disabled={!currentUserId || isPending}
            className={cn(
              'flex items-center gap-1.5 cc-meta text-[11px] transition-colors',
              isLiked ? 'text-success' : 'text-muted-foreground hover:text-foreground',
              (!currentUserId || isPending) && 'opacity-50 cursor-not-allowed'
            )}
            aria-label={isLiked ? 'Unlike' : 'Like'}
          >
            <Heart className={cn('h-3.5 w-3.5', isLiked && 'fill-current')} strokeWidth={1.8} />
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>

          <BookmarkButton itemType="activity" itemId={activity.id} />
        </div>

        <button
          onClick={handleMovieClick}
          className="cc-meta text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          reply →
        </button>
      </div>
    </div>
  );
});
