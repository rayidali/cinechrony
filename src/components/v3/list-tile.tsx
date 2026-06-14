'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Film, Globe, Lock } from 'lucide-react';

/**
 * ListTile — v3 album tile (Phase 0.7). A 1:1 card showing a fan of up to 3
 * real poster thumbnails (or a dashed film placeholder when empty), with a
 * lowercase title + mono "@owner · N films" + a globe/lock visibility glyph.
 */
interface ListTileProps {
  name: string;
  isPublic?: boolean;
  movieCount?: number;
  /** Set for shared/collaborative lists; renders "@owner · N films". */
  ownerName?: string;
  /** Real poster URLs (TMDB / R2). Up to 3 are fanned when no custom cover. */
  previewPosters?: string[];
  /** Custom cover the owner uploaded; shown full-bleed unless coverMode is 'auto'. */
  coverImageUrl?: string;
  coverMode?: 'auto' | 'custom';
  /** Action control over the tile, top-right (e.g. a ⋯ menu). Clicks don't open the tile. */
  overlay?: ReactNode;
  /** Control over the tile, bottom-left (e.g. a like button). Clicks don't open the tile. */
  likeButton?: ReactNode;
  onClick?: (e: MouseEvent) => void;
}

function MiniFan({ posters }: { posters: string[] }) {
  const list = posters.slice(0, 3);
  const transforms =
    list.length === 1
      ? ['rotate(0deg)']
      : list.length === 2
        ? ['rotate(-6deg) translate(-16%,0)', 'rotate(5deg) translate(16%,0)']
        : [
            'rotate(-8deg) translate(-26%,2%)',
            'rotate(6deg) translate(26%,2%)',
            'rotate(-1deg) translate(0,-6%)',
          ];
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {list.map((src, i) => (
        <div
          key={i}
          className="absolute h-[82%] aspect-[2/3] overflow-hidden rounded-[7px] shadow-[0_3px_10px_rgba(0,0,0,0.28)]"
          style={{ transform: transforms[i], zIndex: i }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

export function ListTile({
  name,
  isPublic,
  movieCount = 0,
  ownerName,
  previewPosters = [],
  coverImageUrl,
  coverMode,
  overlay,
  likeButton,
  onClick,
}: ListTileProps) {
  const posters = previewPosters.filter(Boolean);
  // 'auto' coverMode means "use the poster mosaic even if a stale cover exists."
  const hasCustomCover = !!coverImageUrl && coverMode !== 'auto';
  const Visibility = isPublic ? Globe : Lock;

  return (
    // A <div> (not <button>) so action controls (the ⋯ menu) can nest legally.
    <div onClick={onClick} className="group block w-full cursor-pointer text-left">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] border border-hair bg-card shadow-lift transition-transform group-active:scale-[0.98]">
        {hasCustomCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : posters.length > 0 ? (
          <MiniFan posters={posters} />
        ) : (
          <div className="absolute inset-3.5 flex items-center justify-center rounded-xl border border-dashed border-rule text-muted-foreground">
            <Film className="h-6 w-6" strokeWidth={1.4} />
          </div>
        )}
        {overlay && (
          <div className="absolute right-2.5 top-2.5 z-10" onClick={(e) => e.stopPropagation()}>
            {overlay}
          </div>
        )}
        {likeButton && (
          <div className="absolute bottom-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
            {likeButton}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-headline text-base font-bold lowercase leading-tight tracking-tight text-foreground">
            {name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {ownerName ? `@${ownerName} · ` : ''}
            {movieCount} films
          </div>
        </div>
        <Visibility className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.7} />
      </div>
    </div>
  );
}
