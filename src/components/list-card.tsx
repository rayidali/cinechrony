'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Lock, Globe, Film } from 'lucide-react';
import type { MovieList } from '@/lib/types';

interface ListCardProps {
  list: MovieList;
  previewPosters?: string[]; // Up to 3 posters for stacked view
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode; // For dropdown menu etc.
  isCollaborative?: boolean;
  ownerName?: string;
}

/**
 * List cover — design system v2 "editorial composition".
 *
 * v1 used psychedelic three-stop gradients for empty lists. v2 swaps that for
 * a calm bone card: a stacked-poster fan when the list has films, a
 * dashed-hairline film-icon placeholder when it's empty, and an editorial
 * text block below (eyebrow → lowercase display name → tabular meta).
 */
export function ListCard({
  list,
  previewPosters = [],
  onClick,
  children,
  isCollaborative = false,
  ownerName,
}: ListCardProps) {
  const movieCount = list.movieCount ?? 0;
  const hasCustomCover = !!list.coverImageUrl;
  const hasPosters = previewPosters.length > 0;

  const eyebrow = [
    list.isPublic ? 'PUBLIC LIST' : 'PRIVATE LIST',
    isCollaborative && ownerName ? `BY @${ownerName.toUpperCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="relative cursor-pointer group" onClick={onClick}>
      <div
        className={cn(
          'relative aspect-[4/5] rounded-[18px] overflow-hidden',
          'bg-card border border-border shadow-lift',
          'flex flex-col p-3.5',
          'transition-all duration-200',
          'group-hover:shadow-photo group-hover:-translate-y-0.5'
        )}
      >
        {/* Dropdown menu in top-right */}
        {children && (
          <div
            className="absolute top-2.5 right-2.5 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        )}

        {/* Visual area */}
        <div className="relative flex-1 flex items-center justify-center mb-3 min-h-0">
          {hasCustomCover ? (
            <img
              src={list.coverImageUrl}
              alt={list.name}
              className="absolute inset-0 w-full h-full object-cover rounded-[14px]"
            />
          ) : hasPosters ? (
            <PosterFan posters={previewPosters} />
          ) : (
            <div className="absolute inset-0 rounded-[14px] border border-dashed border-border bg-background flex items-center justify-center text-muted-foreground">
              <Film className="h-7 w-7" strokeWidth={1.4} />
            </div>
          )}
        </div>

        {/* Editorial text block */}
        <div className="flex-shrink-0">
          <div className="cc-eyebrow truncate">{eyebrow}</div>
          <h3 className="mt-1.5 font-headline font-bold text-[17px] leading-[1.1] lowercase tracking-tight line-clamp-2">
            {list.name}
          </h3>
          <div className="mt-1.5 flex items-center justify-between cc-meta text-[11px] text-muted-foreground">
            <span>
              {movieCount} {movieCount === 1 ? 'film' : 'films'}
            </span>
            {list.isPublic ? (
              <Globe className="h-3.5 w-3.5" strokeWidth={1.6} />
            ) : (
              <Lock className="h-3.5 w-3.5" strokeWidth={1.6} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fanned stack of up to 3 posters, editorial-calm. */
function PosterFan({ posters }: { posters: string[] }) {
  const displayPosters = posters.slice(0, 3);
  const count = displayPosters.length;

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {displayPosters.map((poster, index) => {
        let transform = '';
        if (count === 1) {
          transform = 'rotate(0deg) translateY(-4%)';
        } else if (count === 2) {
          transform =
            index === 0
              ? 'rotate(-5deg) translate(-12%, -2%)'
              : 'rotate(4deg) translate(12%, -2%)';
        } else {
          transform =
            index === 0
              ? 'rotate(-7deg) translate(-22%, -3%)'
              : index === 1
                ? 'rotate(5deg) translate(22%, -3%)'
                : 'rotate(-1deg) translate(0, -12%)';
        }

        return (
          <img
            key={index}
            src={poster}
            alt=""
            className="absolute h-[88%] aspect-[2/3] object-cover rounded-lg shadow-press"
            style={{ transform, zIndex: index }}
          />
        );
      })}
    </div>
  );
}
