'use client';

import { ReactNode, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Lock, Globe } from 'lucide-react';
import type { MovieList } from '@/lib/types';

interface ListCardProps {
  list: MovieList;
  previewPosters?: string[]; // Up to 3 posters for stacked view
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode; // For dropdown menu etc.
  isCollaborative?: boolean;
  ownerName?: string;
}

// Gradient color combinations for empty lists - crazy/vibrant mixes
const GRADIENT_PALETTES = [
  { from: 'from-yellow-400', via: 'via-pink-500', to: 'to-purple-600' },
  { from: 'from-cyan-400', via: 'via-fuchsia-500', to: 'to-orange-500' },
  { from: 'from-lime-400', via: 'via-emerald-500', to: 'to-blue-600' },
  { from: 'from-rose-500', via: 'via-amber-400', to: 'to-cyan-500' },
  { from: 'from-violet-500', via: 'via-pink-400', to: 'to-yellow-400' },
  { from: 'from-orange-500', via: 'via-red-500', to: 'to-purple-600' },
  { from: 'from-teal-400', via: 'via-violet-500', to: 'to-rose-500' },
  { from: 'from-indigo-500', via: 'via-cyan-400', to: 'to-lime-400' },
  { from: 'from-fuchsia-500', via: 'via-yellow-400', to: 'to-teal-500' },
  { from: 'from-amber-400', via: 'via-rose-500', to: 'to-indigo-600' },
];

// Get consistent gradient based on list ID
function getGradientForList(listId: string) {
  let hash = 0;
  for (let i = 0; i < listId.length; i++) {
    hash = ((hash << 5) - hash) + listId.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[index];
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

  // Get consistent gradient colors for this list
  const gradient = useMemo(() => getGradientForList(list.id), [list.id]);

  // Determine what to show:
  // 1. Custom cover image takes priority
  // 2. If has movies but no custom cover -> show stacked posters
  // 3. No movies and no custom cover -> show gradient
  const showCustomCover = hasCustomCover;
  const showStackedPosters = !hasCustomCover && hasPosters;
  const showGradient = !hasCustomCover && !hasPosters;

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
        {/* Background layer */}
        {showCustomCover && (
          <img
            src={list.coverImageUrl}
            alt={list.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {showStackedPosters && (
          <StackedPosters posters={previewPosters} />
        )}

        {showGradient && (
          <div className={cn(
            'absolute inset-0 bg-gradient-to-br',
            gradient.from,
            gradient.via,
            gradient.to
          )} />
        )}

        {/* Dropdown menu in top-right */}
        {children && (
          <div
            className="absolute top-2 right-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        )}

        {/* Gradual fade overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 via-[35%] to-transparent pointer-events-none" />

        {/* Content at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-[1]">
          {/* List name with lock icon if private */}
          <div className="flex items-start gap-1.5">
            {!list.isPublic && (
              <Lock className="h-4 w-4 text-white flex-shrink-0 mt-0.5" />
            )}
            <h3 className="font-bold text-white text-base leading-tight line-clamp-2">
              {list.name}
            </h3>
          </div>

          {/* Info row: movie count and optionally owner name */}
          <div className="flex items-center gap-2 mt-1 text-white/80 text-xs">
            <span>{movieCount} {movieCount === 1 ? 'movie' : 'movies'}</span>
            {isCollaborative && ownerName && (
              <>
                <span>•</span>
                <span>by {ownerName}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stacked posters component - shows 1-3 posters on white background
function StackedPosters({ posters }: { posters: string[] }) {
  // Take up to 3 posters
  const displayPosters = posters.slice(0, 3);
  const count = displayPosters.length;

  return (
    <div className="absolute inset-0 bg-white flex items-start justify-center pt-4 pb-20">
      <div className="relative w-full h-full flex items-center justify-center">
        {displayPosters.map((poster, index) => {
          // Calculate position based on how many posters and index
          // Stack from back to front: last poster is on top
          const zIndex = index;

          let transform = '';
          let shadow = 'shadow-lg';

          if (count === 1) {
            // Single poster - centered, moved up
            transform = 'rotate(0deg) translateY(-10%)';
          } else if (count === 2) {
            // Two posters - slight offset, moved up
            if (index === 0) {
              transform = 'rotate(-6deg) translate(-10%, -10%)';
            } else {
              transform = 'rotate(4deg) translate(10%, -10%)';
            }
          } else {
            // Three posters - fan layout, moved up
            if (index === 0) {
              transform = 'rotate(-8deg) translate(-22%, -5%)';
            } else if (index === 1) {
              transform = 'rotate(6deg) translate(22%, -5%)';
            } else {
              transform = 'rotate(-2deg) translate(0, -15%)';
            }
          }

          return (
            <img
              key={index}
              src={poster}
              alt=""
              className={cn(
                'absolute h-[60%] aspect-[2/3] object-cover rounded-lg border-2 border-gray-200',
                shadow
              )}
              style={{
                transform,
                zIndex,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
