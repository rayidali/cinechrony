'use client';

import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import type { RecommendationSet, TrendingMovie } from '@/lib/tmdb-server';
import type { Movie } from '@/lib/types';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { getRatingStyle } from '@/lib/utils';

const TMDB_W342 = 'https://image.tmdb.org/t/p/w342';
const TMDB_W500 = 'https://image.tmdb.org/t/p/w500';

function posterUrl(m: TrendingMovie, big = false) {
  if (!m.posterPath) return '/placeholder-poster.png';
  return `${big ? TMDB_W500 : TMDB_W342}${m.posterPath}`;
}

function toMovie(m: TrendingMovie): Movie {
  return {
    id: `${m.mediaType}_${m.id}`,
    title: m.title,
    year: m.releaseDate ? new Date(m.releaseDate).getFullYear().toString() : '',
    posterUrl: posterUrl(m, true),
    posterHint: `${m.title} poster`,
    addedBy: '',
    status: 'To Watch',
    mediaType: m.mediaType,
    tmdbId: m.id,
  };
}

function ratingOf(m: TrendingMovie): number | null {
  const r = m.imdbRating ? parseFloat(m.imdbRating) : m.voteAverage;
  return typeof r === 'number' && r > 0 ? r : null;
}

/**
 * "because you liked X" — an in-reel recommendation row (Phase 0.7 / v3,
 * `ios-home.jsx` FOR-YOU poster row). Borderless: a sparkle eyebrow + lowercase
 * headline + three posters with punched rating stickers. Tap a poster → drawer.
 */
export function RecommendationCard({ set }: { set: RecommendationSet }) {
  const { openMovie } = useMovieModal();
  const recs = set.recommendations.slice(0, 3);
  if (recs.length === 0) return null;

  return (
    <section className="py-5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">
        <Sparkles className="h-3 w-3" strokeWidth={2} />
        for you
      </div>
      <h3
        className="font-headline font-bold text-[22px] lowercase tracking-[-0.03em] text-foreground"
        style={{ fontVariationSettings: '"wdth" 95' }}
      >
        because you liked {set.basisTitle.toLowerCase()}
      </h3>

      <div className="grid grid-cols-3 gap-3 mt-3.5">
        {recs.map((rec) => {
          const rating = ratingOf(rec);
          const style = rating != null ? getRatingStyle(rating) : null;
          return (
            <button
              key={rec.id}
              onClick={() => openMovie(toMovie(rec))}
              aria-label={`Open ${rec.title}`}
              className="text-left group"
            >
              <div className="relative aspect-[2/3] rounded-[14px] overflow-hidden shadow-photo transition-transform duration-200 group-active:scale-[0.97]">
                <Image src={posterUrl(rec)} alt={rec.title} fill className="object-cover" sizes="33vw" />
                {rating != null && style && (
                  <span
                    className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md font-headline font-bold text-[11px] tabular-nums"
                    style={{ ...style.background, ...style.textOnBg }}
                  >
                    {rating.toFixed(1)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 font-headline font-bold text-[13px] lowercase tracking-[-0.02em] text-foreground line-clamp-1">
                {rec.title}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
