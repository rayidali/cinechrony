'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Film, Lock, Globe, Users } from 'lucide-react';
import type { MovieList } from '@/lib/types';

interface ListCardProps {
  list: MovieList;
  previewPosters?: string[]; // Up to 4 poster URLs
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode; // For dropdown menu etc.
  isCollaborative?: boolean;
  ownerName?: string;
}

export function ListCard({
  list,
  previewPosters = [],
  onClick,
  children,
  isCollaborative = false,
  ownerName
}: ListCardProps) {
  const movieCount = list.movieCount ?? 0;
  const hasCustomCover = !!list.coverImageUrl;
  const hasPosters = previewPosters.length > 0;

  return (
    <div
      className={cn(
        'relative cursor-pointer group',
        'transition-all duration-200',
        'active:translate-x-0.5 active:translate-y-0.5'
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          'relative bg-card border-[3px] dark:border-2 border-border rounded-2xl overflow-hidden',
          'shadow-[4px_4px_0px_0px_hsl(var(--border))]',
          'dark:shadow-none',
          'group-hover:shadow-[2px_2px_0px_0px_hsl(var(--border))]',
          'dark:group-hover:shadow-none',
          'group-hover:translate-x-0.5 group-hover:translate-y-0.5',
          'dark:group-hover:translate-x-0 dark:group-hover:translate-y-0',
          'group-active:shadow-none',
          'transition-all duration-200'
        )}
      >
        {/* Cover area with stacked posters or fallback */}
        <div className="relative h-32 bg-muted overflow-hidden">
          {hasCustomCover ? (
            // Custom cover image
            <img
              src={list.coverImageUrl}
              alt={list.name}
              className="w-full h-full object-cover"
            />
          ) : hasPosters ? (
            // Stacked posters
            <StackedPosters posters={previewPosters} />
          ) : (
            // Empty list fallback
            <EmptyListGraphic />
          )}

          {/* Gradient overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Badges positioned in top-right */}
          <div className="absolute top-2 right-2 flex gap-1.5">
            {list.isDefault && (
              <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">
                Default
              </span>
            )}
            {list.isPublic ? (
              <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Globe className="h-3 w-3" />
              </span>
            ) : (
              <span className="text-[10px] bg-muted-foreground/80 text-white px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Lock className="h-3 w-3" />
              </span>
            )}
          </div>

          {/* Movie count in bottom-left */}
          <div className="absolute bottom-2 left-3">
            <span className="text-xs text-white/90 font-medium">
              {movieCount} {movieCount === 1 ? 'movie' : 'movies'}
            </span>
          </div>
        </div>

        {/* List info */}
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isCollaborative ? (
              <Users className="h-4 w-4 text-primary flex-shrink-0" />
            ) : (
              <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">{list.name}</h3>
              {isCollaborative && ownerName && (
                <p className="text-xs text-muted-foreground truncate">by {ownerName}</p>
              )}
            </div>
          </div>
          {/* Dropdown menu slot */}
          {children && (
            <div onClick={(e) => e.stopPropagation()}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stacked posters component
function StackedPosters({ posters }: { posters: string[] }) {
  // Show up to 4 posters in a stacked/fan layout
  const displayPosters = posters.slice(0, 4);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Background blur of first poster */}
      {displayPosters[0] && (
        <img
          src={displayPosters[0]}
          alt=""
          className="absolute inset-0 w-full h-full object-cover blur-xl opacity-50 scale-110"
        />
      )}

      {/* Stacked posters */}
      <div className="relative flex items-center justify-center h-full">
        {displayPosters.map((poster, index) => {
          const totalPosters = displayPosters.length;
          // Calculate rotation and offset based on position
          const rotation = totalPosters === 1 ? 0 : (index - (totalPosters - 1) / 2) * 8;
          const translateX = totalPosters === 1 ? 0 : (index - (totalPosters - 1) / 2) * 20;
          const zIndex = index;

          return (
            <img
              key={index}
              src={poster}
              alt=""
              className="absolute h-24 w-16 object-cover rounded-lg border-2 border-white/20 shadow-lg"
              style={{
                transform: `translateX(${translateX}px) rotate(${rotation}deg)`,
                zIndex,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Empty list fallback graphic
function EmptyListGraphic() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-muted to-muted/50">
      <div className="relative">
        {/* Stack of empty cards */}
        <div className="absolute w-14 h-20 rounded-lg bg-border/30 border-2 border-dashed border-border/50 -rotate-6 -translate-x-2" />
        <div className="absolute w-14 h-20 rounded-lg bg-border/30 border-2 border-dashed border-border/50 rotate-6 translate-x-2" />
        <div className="relative w-14 h-20 rounded-lg bg-card border-2 border-dashed border-border flex items-center justify-center">
          <Film className="h-6 w-6 text-muted-foreground/50" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">No movies yet</p>
    </div>
  );
}
