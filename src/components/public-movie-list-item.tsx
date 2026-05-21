'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import { Eye, EyeOff, Star } from 'lucide-react';
import type { Movie } from '@/lib/types';
import { getRatingStyle } from '@/lib/utils';

type PublicMovieListItemProps = {
  movie: Movie;
  onOpenDetails?: (movie: Movie) => void;
};

export function PublicMovieListItem({ movie, onOpenDetails }: PublicMovieListItemProps) {
  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  // Get rating style for badge
  const ratingStyle = useMemo(() => getRatingStyle(movie.rating ?? null), [movie.rating]);

  return (
    <div
      className="group flex gap-3 p-3 rounded-lg border border-border shadow-lift bg-card cursor-pointer transition-all duration-200 md:hover:shadow-press"
      onClick={handleClick}
    >
      {/* Poster thumbnail */}
      <div className="relative w-16 h-24 flex-shrink-0 rounded overflow-hidden border border-border">
        <Image
          src={movie.posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="64px"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-sm truncate" title={movie.title}>
            {movie.title}
          </h3>
          <p className="text-xs text-muted-foreground">{movie.year}</p>

          {/* Rating */}
          {movie.rating && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="h-3 w-3" style={{ ...ratingStyle.accent, fill: ratingStyle.accent.color }} />
              <span className="text-xs font-medium" style={ratingStyle.accent}>{movie.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Overview preview */}
        {movie.overview && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
            {movie.overview}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div className="flex flex-col items-end justify-start">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            movie.status === 'Watched'
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {movie.status}
        </span>
      </div>
    </div>
  );
}
