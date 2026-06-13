'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { FriendsWatchingCard as FWCard } from '@/lib/friends-watching-server';
import type { Movie, SearchResult } from '@/lib/types';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { AddToListSheet } from './add-to-list-sheet';

function initials(name: string | null, username: string | null) {
  return (username || name || '?').charAt(0).toUpperCase();
}

/**
 * "Your circle is watching" — one aggregated hero card when 2+ followed users
 * touch the same film. 16:9 photo, avatar stack, glass `+ to a list`.
 * See UX_PATTERNS.md — "Friends-Are-Watching".
 */
export function FriendsWatchingCard({ card }: { card: FWCard }) {
  const { openMovie } = useMovieModal();
  const [addOpen, setAddOpen] = useState(false);

  const poster = card.moviePosterUrl || '/placeholder-poster.png';

  const asMovie: Movie = {
    id: `${card.mediaType}_${card.tmdbId}`,
    title: card.movieTitle,
    year: card.movieYear,
    posterUrl: poster,
    posterHint: `${card.movieTitle} poster`,
    addedBy: '',
    status: 'To Watch',
    mediaType: card.mediaType,
    tmdbId: card.tmdbId,
  };
  const asSearchResult: SearchResult = {
    id: String(card.tmdbId),
    title: card.movieTitle,
    year: card.movieYear || 'N/A',
    posterUrl: poster,
    posterHint: `${card.movieTitle} poster`,
    mediaType: card.mediaType,
    tmdbId: card.tmdbId,
  };

  const meta = [
    card.movieYear,
    `${card.friends.length} watching`,
    card.avgRating != null ? `${card.avgRating.toFixed(1)} avg` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="relative aspect-[16/9] rounded-[16px] overflow-hidden shadow-lift">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={card.movieTitle} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/80" />

        {/* tap-through to detail */}
        <button
          onClick={() => openMovie(asMovie)}
          aria-label={`Open ${card.movieTitle}`}
          className="absolute inset-0"
        />

        {/* glass + to a list */}
        <button
          onClick={() => setAddOpen(true)}
          className="absolute top-3 right-3 h-7 inline-flex items-center gap-1.5 px-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white cc-meta text-[10px] lowercase"
        >
          <Plus className="h-3 w-3" strokeWidth={2.2} />
          to a list
        </button>

        {/* content */}
        <div className="absolute inset-x-0 bottom-0 p-3.5 pointer-events-none">
          <span className="inline-block px-2 py-0.5 rounded-full border border-white/40 bg-black/20 backdrop-blur-sm text-white cc-eyebrow text-[8px]">
            your circle is watching
          </span>
          <h3 className="mt-1.5 font-headline font-bold text-lg lowercase tracking-tight text-white leading-tight">
            {card.movieTitle}
          </h3>
          <div className="mt-0.5 cc-meta text-[10px] text-white/75">{meta}</div>
          <div className="mt-2 flex items-center">
            {card.friends.slice(0, 4).map((f, i) => (
              <div
                key={f.uid}
                className="h-[18px] w-[18px] rounded-full border-[1.5px] border-white overflow-hidden bg-muted flex items-center justify-center"
                style={{ marginLeft: i === 0 ? 0 : -6 }}
              >
                {f.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-headline font-bold text-[8px] text-foreground">
                    {initials(f.displayName, f.username)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <AddToListSheet
        movie={addOpen ? asSearchResult : null}
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </>
  );
}
