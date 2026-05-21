'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import { EyeOff, Check, Maximize2, Instagram, Youtube } from 'lucide-react';
import type { Movie } from '@/lib/types';
import { parseVideoUrl } from '@/lib/video-utils';
import { TiktokIcon } from './icons';
import { getRatingStyle } from '@/lib/utils';

type PublicMovieGridProps = {
  movie: Movie;
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

export function PublicMovieGrid({ movie, onOpenDetails }: PublicMovieGridProps) {
  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  // Check for social link
  const SocialIcon = getProviderIcon(movie.socialLink);
  const hasSocialLink = !!SocialIcon;

  // Get rating style for badge
  const ratingStyle = useMemo(() => getRatingStyle(movie.rating ?? null), [movie.rating]);

  return (
    <div className="group relative cursor-pointer" onClick={handleClick}>
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-[14px] overflow-hidden border border-border shadow-lift transition-all duration-200 md:group-hover:shadow-photo md:group-hover:-translate-y-0.5">
        <Image
          src={movie.posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
        />

        {/* Top row: Rating + Social Icon */}
        <div className="absolute top-1 left-1 right-1 flex justify-between items-start">
          {/* Rating badge */}
          {movie.rating ? (
            <div
              className="px-1.5 py-0.5 rounded font-headline font-bold text-xs tabular-nums"
              style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
            >
              {movie.rating.toFixed(1)}
            </div>
          ) : (
            <div />
          )}

          {/* Social link badge */}
          {hasSocialLink && (
            <div className="bg-black/55 backdrop-blur-sm text-white p-1 rounded-md" title="Has video link">
              <SocialIcon className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Bottom right: Status indicator */}
        <div className="absolute bottom-1 right-1">
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

        {/* Hover overlay - desktop only */}
        <div className="absolute inset-0 bg-black/60 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="flex items-center gap-1 text-white text-xs">
            <Maximize2 className="h-4 w-4" />
            <span className="font-medium">View Details</span>
          </div>
        </div>

      </div>

      {/* Title and year below poster */}
      <div className="mt-1.5 px-0.5">
        <p className="text-[13px] font-headline font-semibold lowercase tracking-tight truncate leading-tight" title={movie.title}>
          {movie.title}
        </p>
        <p className="cc-meta text-[11px] text-muted-foreground">{movie.year}</p>
      </div>
    </div>
  );
}
