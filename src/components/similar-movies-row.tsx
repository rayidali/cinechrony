'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { type TrendingMovie } from '@/app/actions';
import type { Movie } from '@/lib/types';
import { getCachedSimilar, getSimilarWithCache } from '@/lib/tmdb-details-cache';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

type SimilarMoviesRowProps = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  /** Tapping a poster hands the picked film back so the modal can swap to it. */
  onPick: (movie: Movie) => void;
};

/**
 * "more like this" — a horizontal poster strip on the movie-detail screen,
 * powered by TMDB recommendations (getSimilarMovies). Browse-only: tapping a
 * poster swaps the detail modal to that film in place (no modal stacking).
 *
 * Mirrors the module-level cache pattern used for movie/TV details: the first
 * open fires the network call and warms the cache, every subsequent open in
 * the session is a synchronous hit. This is the same iOS PWA back-nav race
 * that was nuking the details fetch — server actions go through the same
 * abort window, so the row needs the same shield.
 */
export function SimilarMoviesRow({ tmdbId, mediaType, onPick }: SimilarMoviesRowProps) {
  // Seed from the cache on first render — instant paint on re-open.
  const initialCached = useMemo(() => {
    if (!tmdbId || Number.isNaN(tmdbId)) return null;
    return getCachedSimilar(mediaType, tmdbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // First-render only.
  const [movies, setMovies] = useState<TrendingMovie[]>(initialCached ?? []);
  const [isLoading, setIsLoading] = useState(initialCached === null);

  useEffect(() => {
    if (!tmdbId || Number.isNaN(tmdbId)) {
      setMovies([]);
      setIsLoading(false);
      return;
    }

    // Synchronous cache hit — no network call, no loading state.
    const cached = getCachedSimilar(mediaType, tmdbId);
    if (cached) {
      setMovies(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    getSimilarWithCache(mediaType, tmdbId)
      .then((res) => {
        if (!cancelled) setMovies(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType]);

  if (!isLoading && movies.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="cc-eyebrow">more like this</div>
      <div className="h-px bg-border my-3" />
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[92px] aspect-[2/3] rounded-[10px] bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-hide">
          {movies.map((m) => (
            <SimilarPoster key={m.id} movie={m} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

function SimilarPoster({
  movie,
  onPick,
}: {
  movie: TrendingMovie;
  onPick: (movie: Movie) => void;
}) {
  const posterUrl = movie.posterPath
    ? `${TMDB_IMAGE_BASE}${movie.posterPath}`
    : '/placeholder-poster.png';
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : '';

  const handlePick = () => {
    onPick({
      id: `${movie.mediaType}_${movie.id}`,
      title: movie.title,
      year: year ? String(year) : '',
      posterUrl: movie.posterPath
        ? `https://image.tmdb.org/t/p/w500${movie.posterPath}`
        : '/placeholder-poster.png',
      posterHint: `${movie.title} poster`,
      addedBy: '',
      status: 'To Watch',
      mediaType: movie.mediaType,
      tmdbId: movie.id,
    });
  };

  return (
    <button onClick={handlePick} className="flex-shrink-0 w-[92px] text-left group">
      <div className="relative aspect-[2/3] rounded-[10px] overflow-hidden border border-border shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
        <Image src={posterUrl} alt={movie.title} fill className="object-cover" sizes="92px" />
      </div>
      <p className="mt-1.5 font-headline font-semibold text-[12px] lowercase tracking-tight line-clamp-1">
        {movie.title}
      </p>
      {year && <p className="cc-meta text-[10px] text-muted-foreground">{year}</p>}
    </button>
  );
}
