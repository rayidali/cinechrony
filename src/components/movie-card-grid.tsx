'use client';

import Image from 'next/image';
import { memo, useMemo } from 'react';
import { Eye, EyeOff, Star, Maximize2, Instagram, Youtube, Tv } from 'lucide-react';

import type { Movie } from '@/lib/types';
import { parseVideoUrl } from '@/lib/video-utils';
import { useUser } from '@/firebase';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
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

  // Use denormalized user data from movie doc - no fetch needed!
  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const addedByName = useMemo(() => {
    if (isAddedByCurrentUser) return 'You';
    // Use denormalized data from movie doc
    return movie.addedByDisplayName || movie.addedByUsername || null;
  }, [isAddedByCurrentUser, movie.addedByDisplayName, movie.addedByUsername]);

  const addedByInitial = addedByName ? addedByName.charAt(0).toUpperCase() : null;

  // Build note author names using denormalized data when available
  const noteAuthors = useMemo(() => {
    const authors: Record<string, string> = {};
    notesEntries.forEach(([uid]) => {
      if (uid === user?.uid) {
        authors[uid] = user?.displayName || user?.email?.split('@')[0] || 'you';
      } else if (uid === movie.addedBy && movie.addedByUsername) {
        // Use denormalized data for the person who added the movie
        authors[uid] = movie.addedByUsername;
      } else {
        // For other collaborators, show shortened uid as fallback
        // In practice, most notes are from the current user or movie adder
        authors[uid] = 'user';
      }
    });
    return authors;
  }, [notesEntries, user?.uid, user?.displayName, user?.email, movie.addedBy, movie.addedByUsername]);

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
      <div className="relative aspect-[2/3] rounded-md overflow-hidden border-[2px] border-black shadow-[3px_3px_0px_0px_#000] transition-all duration-200 md:group-hover:shadow-[1px_1px_0px_0px_#000] md:group-hover:translate-x-0.5 md:group-hover:translate-y-0.5">
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
                className="px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-0.5"
                style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
                title={`Your rating: ${userRating.toFixed(1)}/10`}
              >
                <Star className="h-3 w-3" style={{ fill: 'currentColor' }} />
                {userRating.toFixed(1)}
              </div>
            ) : null}
            {/* TV badge */}
            {movie.mediaType === 'tv' && (
              <div className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-0.5" title="TV Show">
                <Tv className="h-3 w-3" />
              </div>
            )}
          </div>

          {/* Social link badge */}
          {hasSocialLink && (
            <div className="bg-black/80 text-white p-1 rounded" title="Has video link">
              <SocialIcon className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Bottom row: Added by + Status */}
        <div className="absolute bottom-1 left-1 right-1 flex justify-between items-end">
          {/* Added by indicator */}
          {addedByInitial && listOwnerId && (
            <div
              className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center border border-white"
              title={`Added by ${addedByName}`}
            >
              {addedByInitial}
            </div>
          )}
          {!addedByInitial && <div />}

          {/* Status indicator */}
          <div
            className={`w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${
              movie.status === 'Watched' ? 'bg-green-500' : 'bg-yellow-500'
            }`}
            title={movie.status}
          >
            {movie.status === 'Watched' ? (
              <Eye className="h-3 w-3 text-white" />
            ) : (
              <EyeOff className="h-3 w-3 text-white" />
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
        <p className="text-xs font-medium truncate leading-tight" title={movie.title}>
          {movie.title}
        </p>
        <p className="text-xs text-muted-foreground">{movie.year}</p>

        {/* Notes displayed below title */}
        {notesEntries.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {notesEntries.slice(0, 2).map(([uid, note]) => (
              <div key={uid} className="text-[11px] leading-snug">
                <span className="font-semibold text-primary">@{noteAuthors[uid] || '...'}</span>
                <span className="text-muted-foreground/60 mx-1">·</span>
                <span className="text-muted-foreground line-clamp-1 break-words">{note}</span>
              </div>
            ))}
            {notesEntries.length > 2 && (
              <p className="text-[10px] text-muted-foreground/50 font-medium">+{notesEntries.length - 2} more</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
