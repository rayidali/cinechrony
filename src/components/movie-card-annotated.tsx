'use client';

import Image from 'next/image';
import { memo, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Movie } from '@/lib/types';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
import { getRatingStyle } from '@/lib/utils';

type MovieCardAnnotatedProps = {
  movie: Movie;
  onOpenDetails?: (movie: Movie) => void;
};

/**
 * Annotated list row — design system v2 "the reading mode".
 *
 * The opt-in view for a shared list with an active conversation: poster +
 * title + rating on one row, then every collaborator's note below as an
 * editorial pull-quote with a small avatar. See preview/pattern-notes.html.
 */
export const MovieCardAnnotated = memo(function MovieCardAnnotated({
  movie,
  onOpenDetails,
}: MovieCardAnnotatedProps) {
  const { getRating } = useUserRatingsCache();
  const tmdbId = movie.tmdbId || (movie.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);
  const notes = useMemo(() => Object.entries(movie.notes || {}), [movie.notes]);

  const open = () => onOpenDetails?.(movie);

  return (
    <div className="flex gap-3 py-4 border-b border-border last:border-0">
      <button onClick={open} className="flex-shrink-0" aria-label={`Open ${movie.title}`}>
        <div className="w-14 aspect-[2/3] rounded-[8px] overflow-hidden border border-border relative">
          <Image src={movie.posterUrl} alt={movie.title} fill className="object-cover" sizes="56px" />
        </div>
      </button>

      <div className="flex-1 min-w-0">
        {/* Title + rating */}
        <div className="flex items-start justify-between gap-2">
          <button onClick={open} className="text-left min-w-0">
            <h3 className="font-headline font-semibold text-[15px] lowercase tracking-tight leading-tight line-clamp-1">
              {movie.title}
            </h3>
            <p className="cc-meta text-[11px] text-muted-foreground mt-0.5">{movie.year}</p>
          </button>
          {userRating !== null && (
            <span
              className="flex-shrink-0 px-1.5 py-0.5 rounded font-headline font-bold text-[11px] tabular-nums"
              style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
            >
              {userRating.toFixed(1)}
            </span>
          )}
        </div>

        {/* Notes — every collaborator's annotation, or a prompt */}
        {notes.length > 0 ? (
          <div className="mt-2.5 space-y-2.5">
            {notes.map(([uid, note]) => {
              const author = movie.noteAuthors?.[uid];
              const name = author?.username || author?.displayName || 'user';
              const photo = author?.photoURL;
              return (
                <div key={uid} className="flex items-start gap-2">
                  {photo ? (
                    <Image
                      src={photo}
                      alt={name}
                      width={18}
                      height={18}
                      className="rounded-full mt-0.5 flex-shrink-0 object-cover w-[18px] h-[18px]"
                    />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full bg-muted flex items-center justify-center mt-0.5 flex-shrink-0">
                      <span className="font-headline font-bold text-[9px]">
                        {name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-serif italic text-[13px] leading-snug text-foreground break-words">
                      {note}
                    </p>
                    <p className="cc-meta text-[9px] text-muted-foreground mt-0.5">— @{name}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <button
            onClick={open}
            className="mt-2 inline-flex items-center gap-1 cc-meta text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            add the first note
          </button>
        )}
      </div>
    </div>
  );
});
