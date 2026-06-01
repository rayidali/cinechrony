'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Plus, Star } from 'lucide-react';
import type { RecommendationSet, TrendingMovie } from '@/lib/tmdb-server';
import type { Movie, SearchResult } from '@/lib/types';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { AddToListSheet } from './add-to-list-sheet';

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

function toSearchResult(m: TrendingMovie): SearchResult {
  return {
    id: String(m.id),
    title: m.title,
    year: m.releaseDate ? new Date(m.releaseDate).getFullYear().toString() : 'N/A',
    posterUrl: posterUrl(m, true),
    posterHint: `${m.title} poster`,
    mediaType: m.mediaType,
    tmdbId: m.id,
  };
}

/**
 * "if you liked X" — a recommendation card interleaved into the home feed.
 *
 * Three TMDB recommendations off a film the viewer rated highly. Two
 * affordances per poster: tap the body → open detail (browse-first); tap the
 * film-red `+` → the "which list?" sheet (explicit add). See UX_PATTERNS.md.
 */
export function RecommendationCard({ set }: { set: RecommendationSet }) {
  const { openMovie } = useMovieModal();
  const [addTarget, setAddTarget] = useState<SearchResult | null>(null);

  const recs = set.recommendations.slice(0, 3);
  if (recs.length === 0) return null;

  return (
    <>
      <div className="bg-muted border border-border rounded-[16px] p-4 shadow-lift">
        <div className="cc-eyebrow flex items-center gap-1.5">
          <Star className="h-3 w-3 fill-current" strokeWidth={0} />
          for you · if you liked {set.basisTitle.toLowerCase()}
        </div>
        <p className="font-serif italic text-[14px] leading-snug text-foreground mt-2 mb-3">
          {set.reason}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {recs.map((rec) => (
            <div key={rec.id}>
              <div className="relative">
                <button
                  onClick={() => openMovie(toMovie(rec))}
                  className="block w-full group"
                  aria-label={`Open ${rec.title}`}
                >
                  <div className="relative aspect-[2/3] rounded-[10px] overflow-hidden border border-border shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
                    <Image
                      src={posterUrl(rec)}
                      alt={rec.title}
                      fill
                      className="object-cover"
                      sizes="33vw"
                    />
                  </div>
                </button>
                <button
                  onClick={() => setAddTarget(toSearchResult(rec))}
                  aria-label={`Add ${rec.title} to a list`}
                  className="absolute bottom-1.5 right-1.5 h-[22px] w-[22px] rounded-full bg-primary text-white flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,0.25)] transition-transform active:scale-90"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
              <p className="mt-1.5 font-headline font-semibold text-[11px] lowercase tracking-tight line-clamp-1">
                {rec.title}
              </p>
            </div>
          ))}
        </div>
      </div>

      <AddToListSheet
        movie={addTarget}
        isOpen={!!addTarget}
        onClose={() => setAddTarget(null)}
      />
    </>
  );
}
