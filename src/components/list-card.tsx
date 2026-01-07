'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Film, Lock } from 'lucide-react';
import type { MovieList } from '@/lib/types';

interface ListCardProps {
  list: MovieList;
  previewPosters?: string[]; // First poster used as cover
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
  const hasPoster = previewPosters.length > 0;

  // Use custom cover, first poster, or gradient fallback
  const coverImage = hasCustomCover ? list.coverImageUrl : (hasPoster ? previewPosters[0] : null);

  return (
    <div
      className={cn(
        'relative cursor-pointer group',
        'transition-all duration-200',
        'active:scale-[0.98]'
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          'relative aspect-[4/5] rounded-2xl overflow-hidden',
          'border-[3px] dark:border-2 border-border',
          'shadow-[4px_4px_0px_0px_hsl(var(--border))]',
          'dark:shadow-none',
          'group-active:shadow-none group-active:translate-x-0.5 group-active:translate-y-0.5',
          'transition-all duration-200'
        )}
      >
        {/* Cover image or gradient fallback */}
        {coverImage ? (
          <img
            src={coverImage}
            alt={list.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <DefaultCoverGradient />
        )}

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Dropdown menu in top-right */}
        {children && (
          <div
            className="absolute top-2 right-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        )}

        {/* Content at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          {/* List name with lock icon if private */}
          <div className="flex items-start gap-1.5">
            {!list.isPublic && (
              <Lock className="h-4 w-4 text-white/80 flex-shrink-0 mt-0.5" />
            )}
            <h3 className="font-bold text-white text-lg leading-tight line-clamp-2">
              {list.name}
            </h3>
          </div>

          {/* Movie count or owner name */}
          <p className="text-white/70 text-sm mt-1">
            {isCollaborative && ownerName ? (
              `by ${ownerName}`
            ) : (
              `${movieCount} ${movieCount === 1 ? 'movie' : 'movies'}`
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// Default gradient for lists without cover
function DefaultCoverGradient() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center">
      <Film className="h-12 w-12 text-white/30" />
    </div>
  );
}
