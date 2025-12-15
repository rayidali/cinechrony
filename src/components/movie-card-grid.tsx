'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { Eye, EyeOff, Star, Maximize2, Instagram, Youtube, Tv } from 'lucide-react';

import type { Movie, UserProfile } from '@/lib/types';
import { parseVideoUrl } from '@/lib/video-utils';
import { useUser } from '@/firebase';
import { getUserProfile } from '@/app/actions';
import { TiktokIcon } from './icons';

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

export function MovieCardGrid({
  movie,
  listId,
  listOwnerId,
  onOpenDetails,
}: MovieCardGridProps) {
  const [addedByUser, setAddedByUser] = useState<UserProfile | null>(null);
  const { user } = useUser();

  // Fetch the user who added this movie
  useEffect(() => {
    async function fetchAddedByUser() {
      if (!movie.addedBy) return;
      // Skip fetching if it's the current user
      if (movie.addedBy === user?.uid) return;
      try {
        const result = await getUserProfile(movie.addedBy);
        if (result.user) {
          setAddedByUser(result.user);
        }
      } catch (error) {
        console.error('Failed to fetch addedBy user:', error);
      }
    }
    fetchAddedByUser();
  }, [movie.addedBy, user?.uid]);

  if (!user) return null;

  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  // Check for social link
  const SocialIcon = getProviderIcon(movie.socialLink);
  const hasSocialLink = !!SocialIcon;

  // Get added by display info
  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const addedByName = isAddedByCurrentUser
    ? 'You'
    : addedByUser?.displayName || addedByUser?.username || null;
  const addedByInitial = addedByName ? addedByName.charAt(0).toUpperCase() : null;

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
          {/* Left side: Rating + TV badge */}
          <div className="flex items-center gap-1">
            {/* Rating badge */}
            {movie.rating ? (
              <div className="bg-black/80 text-white px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                {movie.rating.toFixed(1)}
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

      {/* Title and year below poster */}
      <div className="mt-1.5 px-0.5">
        <p className="text-xs font-medium truncate leading-tight" title={movie.title}>
          {movie.title}
        </p>
        <p className="text-xs text-muted-foreground">{movie.year}</p>
      </div>
    </div>
  );
}
