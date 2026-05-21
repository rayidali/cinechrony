'use client';

import { ReactNode } from 'react';
import { Film } from 'lucide-react';

interface ProfileListCardProps {
  name: string;
  isPublic?: boolean;
  isCollaborative?: boolean;
  ownerName?: string;
  movieCount: number;
  coverImageUrl?: string;
  previewPosters?: string[];
  updatedLabel?: string;
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

/**
 * Mosaic list cover — design system v2, profile surface only.
 *
 * Richer than the lists-screen cover: a 2-up mosaic (one big poster + two
 * stacked) gives a far more legible read of someone's catalogue when you're
 * scanning their shelf. Editorial meta block below — eyebrow, lowercase
 * display name, tabular date. See preview/pattern-profile.html.
 */
export function ProfileListCard({
  name,
  isPublic,
  isCollaborative,
  ownerName,
  movieCount,
  coverImageUrl,
  previewPosters = [],
  updatedLabel,
  onClick,
  children,
}: ProfileListCardProps) {
  const posters = previewPosters.slice(0, 3);
  const eyebrow = [
    isCollaborative
      ? ownerName
        ? `SHARED · WITH @${ownerName.toUpperCase()}`
        : 'SHARED'
      : isPublic
        ? 'PUBLIC'
        : 'PRIVATE',
    `${movieCount} ${movieCount === 1 ? 'FILM' : 'FILMS'}`,
  ].join(' · ');

  return (
    <div className="relative cursor-pointer group" onClick={onClick}>
      <div className="rounded-2xl border border-border bg-card shadow-lift overflow-hidden transition-all duration-200 group-hover:shadow-photo group-hover:-translate-y-0.5">
        {/* Cover — custom image, poster mosaic, or dashed empty */}
        <div className="relative aspect-[4/3]">
          {children && (
            <div
              className="absolute top-2 right-2 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          )}

          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt={name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : posters.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background text-muted-foreground">
              <Film className="h-7 w-7" strokeWidth={1.4} />
            </div>
          ) : (
            <div className="absolute inset-0 grid grid-cols-[2fr_1fr] gap-px bg-border">
              <div className="bg-background overflow-hidden">
                <img src={posters[0]} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="grid grid-rows-2 gap-px">
                {[posters[1], posters[2]].map((p, i) => (
                  <div key={i} className="bg-background overflow-hidden">
                    {p ? (
                      <img src={p} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Editorial meta */}
        <div className="p-3">
          <div className="cc-eyebrow truncate">{eyebrow}</div>
          <h3 className="font-headline font-bold text-[15px] lowercase tracking-tight leading-tight mt-1 line-clamp-1">
            {name}
          </h3>
          {updatedLabel && (
            <p className="cc-meta text-[10px] text-muted-foreground mt-1">{updatedLabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}
