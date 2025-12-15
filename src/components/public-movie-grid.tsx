'use client';

import Image from 'next/image';
import { Eye, EyeOff, Star } from 'lucide-react';
import type { Movie } from '@/lib/types';

type PublicMovieGridProps = {
  movie: Movie;
  onOpenDetails?: (movie: Movie) => void;
};

export function PublicMovieGrid({ movie, onOpenDetails }: PublicMovieGridProps) {
  const handleClick = () => {
    if (onOpenDetails) {
      onOpenDetails(movie);
    }
  };

  return (
    <div className="group relative cursor-pointer" onClick={handleClick}>
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-md overflow-hidden border-[2px] border-black shadow-[3px_3px_0px_0px_#000] transition-all duration-200 md:group-hover:shadow-[1px_1px_0px_0px_#000] md:group-hover:translate-x-0.5 md:group-hover:translate-y-0.5">
        <Image
          src={movie.posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
        />

        {/* Rating badge (if available) */}
        {movie.rating && (
          <div className="absolute top-1 left-1 bg-black/80 text-white px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            {movie.rating.toFixed(1)}
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute bottom-1 right-1">
          <div
            className={`w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${
              movie.status === 'Watched' ? 'bg-green-500' : 'bg-yellow-500'
            }`}
          >
            {movie.status === 'Watched' ? (
              <Eye className="h-3 w-3 text-white" />
            ) : (
              <EyeOff className="h-3 w-3 text-white" />
            )}
          </div>
        </div>

        {/* Hover overlay - desktop only */}
        <div className="absolute inset-0 bg-black/60 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-xs font-bold px-2 py-1 bg-black/50 rounded">
            View Details
          </span>
        </div>
      </div>

      {/* Title below poster */}
      <div className="mt-1 px-0.5">
        <p className="text-xs font-medium truncate" title={movie.title}>
          {movie.title}
        </p>
        <p className="text-xs text-muted-foreground">{movie.year}</p>
      </div>
    </div>
  );
}
