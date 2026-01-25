'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Flame, Star } from 'lucide-react';
import { getTrendingMovies, type TrendingMovie } from '@/app/actions';
import { PublicMovieDetailsModal } from './public-movie-details-modal';
import type { Movie } from '@/lib/types';

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185';

// Skeleton component for loading state
function TrendingSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex-shrink-0 w-28">
          <div className="aspect-[2/3] rounded-xl bg-muted animate-pulse border-2 border-border" />
          <div className="mt-2 h-3 bg-muted rounded animate-pulse w-3/4" />
          <div className="mt-1 h-2 bg-muted rounded animate-pulse w-1/2" />
        </div>
      ))}
    </div>
  );
}

// IMDb logo component
function IMDbBadge({ rating }: { rating: string }) {
  return (
    <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
      <svg viewBox="0 0 64 32" className="h-3 w-auto" fill="currentColor">
        <rect width="64" height="32" rx="4" fill="#F5C518" />
        <text
          x="32"
          y="23"
          textAnchor="middle"
          fill="black"
          fontSize="18"
          fontWeight="bold"
          fontFamily="Arial, sans-serif"
        >
          IMDb
        </text>
      </svg>
      <span className="text-[10px] font-bold text-white">{rating}</span>
    </div>
  );
}

// Individual trending movie card
function TrendingMovieCard({
  movie,
  onSelect,
}: {
  movie: TrendingMovie;
  onSelect: (movie: TrendingMovie) => void;
}) {
  const posterUrl = movie.posterPath
    ? `${TMDB_IMAGE_BASE_URL}${movie.posterPath}`
    : '/placeholder-poster.png';

  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : '';

  return (
    <button
      onClick={() => onSelect(movie)}
      className="flex-shrink-0 w-28 text-left group"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border-[3px] dark:border-2 border-border shadow-[3px_3px_0px_0px_hsl(var(--border))] dark:shadow-none group-active:shadow-none group-active:translate-x-0.5 group-active:translate-y-0.5 transition-all">
        <Image
          src={posterUrl}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="112px"
        />
        {/* Rating badge - prefer IMDB, fallback to TMDB */}
        {movie.imdbRating ? (
          <IMDbBadge rating={movie.imdbRating} />
        ) : movie.voteAverage > 0 ? (
          <div className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
            <span className="text-[10px] font-bold text-white">
              {movie.voteAverage.toFixed(1)}
            </span>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium line-clamp-1">{movie.title}</p>
      <p className="text-xs text-muted-foreground">{year}</p>
    </button>
  );
}

export function TrendingMovies() {
  const [movies, setMovies] = useState<TrendingMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    async function loadTrending() {
      try {
        const result = await getTrendingMovies();
        if (result.error) {
          setError(result.error);
        } else {
          setMovies(result.movies);
        }
      } catch (err) {
        setError('Failed to load trending movies');
      } finally {
        setIsLoading(false);
      }
    }

    loadTrending();
  }, []);

  const handleSelectMovie = (trendingMovie: TrendingMovie) => {
    // Convert TrendingMovie to minimal Movie type for modal
    const movieForModal: Movie = {
      id: `movie_${trendingMovie.id}`,
      title: trendingMovie.title,
      year: trendingMovie.releaseDate ? new Date(trendingMovie.releaseDate).getFullYear().toString() : '',
      posterUrl: trendingMovie.posterPath
        ? `https://image.tmdb.org/t/p/w500${trendingMovie.posterPath}`
        : '/placeholder-poster.png',
      posterHint: `${trendingMovie.title} movie poster`,
      addedBy: '', // Not applicable for trending
      status: 'To Watch',
      mediaType: trendingMovie.mediaType,
      tmdbId: trendingMovie.id,
    };

    setSelectedMovie(movieForModal);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedMovie(null);
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-headline font-bold">Trending Today</h2>
        </div>
      </div>

      {isLoading ? (
        <TrendingSkeleton />
      ) : error ? (
        <p className="text-sm text-muted-foreground py-4">{error}</p>
      ) : movies.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No trending movies available</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4">
          {movies.map((movie) => (
            <TrendingMovieCard
              key={movie.id}
              movie={movie}
              onSelect={handleSelectMovie}
            />
          ))}
        </div>
      )}

      {/* Movie Details Modal */}
      <PublicMovieDetailsModal
        movie={selectedMovie}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </section>
  );
}
