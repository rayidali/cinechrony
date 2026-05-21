'use client';

import Image from 'next/image';
import { memo, useMemo } from 'react';
import { EyeOff, Check, Maximize2, Instagram, Youtube, Tv, Bookmark } from 'lucide-react';

import type { Movie } from '@/lib/types';
import { parseVideoUrl } from '@/lib/video-utils';
import { useUser } from '@/firebase';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { TiktokIcon } from './icons';
import { getRatingStyle } from '@/lib/utils';

type MovieCardGridProps = {
  movie: Movie;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
  onOpenDetails?: (movie: Movie) => void;
};

function getProviderIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  switch (parsed.provider) {
    case 'tiktok':
      return TiktokIcon;
    case 'instagram':
      return Instagram;
    case 'youtube':
      return Youtube;
    default:
      return null;
  }
}

export const MovieCardGrid = memo(function MovieCardGrid({
  movie,
  listId,
  listOwnerId,
  onOpenDetails,
}: MovieCardGridProps) {
  const { user } = useUser();
  const { getRating } = useUserRatingsCache();

  // Get TMDB ID for rating lookup
  const tmdbId = movie.tmdbId || (movie.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Get user's rating from cache - O(1) lookup, no network call
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);

  // Get rating style for badge (uses HSL interpolation for consistent colors)
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);

  // Get notes to display (memoized to prevent array recreation)
  const notesEntries = useMemo(
    () => (movie.notes ? Object.entries(movie.notes) : []),
    [movie.notes]
  );

  // AUDIT.md 2.3b: live profile cache override of the denormalized snapshot
  // captured on the movie doc at add-time. Username is immutable (2.3a) and
  // not overridden.
  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const liveAdder = useUserProfile(isAddedByCurrentUser ? null : movie.addedBy);
  const addedByName = useMemo(() => {
    if (isAddedByCurrentUser) return 'You';
    // Live displayName takes precedence; fall through to denormalized fields.
    return liveAdder?.displayName || movie.addedByDisplayName || movie.addedByUsername || null;
  }, [isAddedByCurrentUser, liveAdder?.displayName, movie.addedByDisplayName, movie.addedByUsername]);

  const addedByInitial = addedByName ? addedByName.charAt(0).toUpperCase() : null;

  // Notes — v2 "marginalia" treatment: a count chip on the poster, plus the
  // user's own note peeking below the title as a serif-italic pull-quote.
  // Everyone else's notes live on the movie detail screen, not crowded here.
  const noteCount = notesEntries.length;
  const ownNote = user?.uid ? movie.notes?.[user.uid] : undefined;

  if (!user) return null;

  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  // Check for social link
  const SocialIcon = getProviderIcon(movie.socialLink);
  const hasSocialLink = !!SocialIcon;

  return (
    <div
      className="group relative cursor-pointer"
      onClick={handleClick}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-[14px] overflow-hidden border border-border shadow-lift transition-all duration-200 md:group-hover:shadow-photo md:group-hover:-translate-y-0.5">
        <Image
          src={movie.posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
        />

        {/* Top row: Rating + TV badge + Social Icon */}
        <div className="absolute top-1 left-1 right-1 flex justify-between items-start">
          {/* Left side: User Rating + TV badge */}
          <div className="flex items-center gap-1">
            {/* User's personal rating badge - color reflects rating */}
            {userRating !== null ? (
              <div
                className="px-1.5 py-0.5 rounded font-headline font-bold text-xs tabular-nums"
                style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
                title={`Your rating: ${userRating.toFixed(1)}/10`}
              >
                {userRating.toFixed(1)}
              </div>
            ) : null}
            {/* TV badge */}
            {movie.mediaType === 'tv' && (
              <div className="bg-black/55 backdrop-blur-sm text-white p-1 rounded-md flex items-center" title="TV Show">
                <Tv className="h-3 w-3" strokeWidth={1.8} />
              </div>
            )}
          </div>

          {/* Social link badge */}
          {hasSocialLink && (
            <div className="bg-black/55 backdrop-blur-sm text-white p-1 rounded-md" title="Has video link">
              <SocialIcon className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Bottom row: Added by + Note count · Status */}
        <div className="absolute bottom-1 left-1 right-1 flex justify-between items-end">
          {/* Left group: added-by initial + note count chip */}
          <div className="flex items-center gap-1">
            {addedByInitial && listOwnerId && (
              <div
                className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-headline font-bold flex items-center justify-center ring-2 ring-white/70"
                title={`Added by ${addedByName}`}
              >
                {addedByInitial}
              </div>
            )}
            {noteCount > 0 && (
              <div
                className="flex items-center gap-0.5 px-1.5 h-5 rounded-full bg-black/55 backdrop-blur-sm text-white cc-meta text-[9px]"
                title={`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}
              >
                <Bookmark className="h-2.5 w-2.5" strokeWidth={2} />
                {noteCount}
              </div>
            )}
          </div>

          {/* Status indicator */}
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center ring-1 ring-white/70 ${
              movie.status === 'Watched'
                ? 'bg-[oklch(0.52_0.11_150)]'
                : 'bg-black/50 backdrop-blur-sm'
            }`}
            title={movie.status}
          >
            {movie.status === 'Watched' ? (
              <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
            ) : (
              <EyeOff className="h-3 w-3 text-white" strokeWidth={1.8} />
            )}
          </div>
        </div>

        {/* Hover overlay - desktop only, just shows "View Details" */}
        <div className="absolute inset-0 bg-black/50 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="flex items-center gap-1.5 text-white text-sm bg-black/60 px-3 py-1.5 rounded-full">
            <Maximize2 className="h-4 w-4" />
            <span className="font-medium">View Details</span>
          </div>
        </div>
      </div>

      {/* Title, year, and notes below poster */}
      <div className="mt-1.5 px-0.5">
        <p className="text-[13px] font-headline font-semibold lowercase tracking-tight truncate leading-tight" title={movie.title}>
          {movie.title}
        </p>
        <p className="cc-meta text-[11px] text-muted-foreground">{movie.year}</p>

        {/* Your own note — marginalia pull-quote */}
        {ownNote && (
          <p className="mt-1.5 pl-1.5 border-l border-border font-serif italic text-[11px] leading-snug text-foreground/80 line-clamp-2 break-words">
            {ownNote}
          </p>
        )}
      </div>
    </div>
  );
});
