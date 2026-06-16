'use client';

import Image from 'next/image';
import { Film, Tv } from 'lucide-react';

/**
 * The 3-up poster grid tile shared by the home search overlay and the add-movie
 * search — big poster carries the visual weight (the "confident, takes its
 * space" feel), lowercase title + year beneath, media glyph in the corner.
 */
export function FilmGridTile({
  posterUrl,
  title,
  year,
  isTv,
  onOpen,
}: {
  posterUrl: string;
  title: string;
  year?: string;
  isTv?: boolean;
  onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="text-left group">
      <div className="relative aspect-[2/3] rounded-[12px] overflow-hidden border border-border shadow-lift transition-transform duration-200 group-active:scale-[0.97]">
        <Image src={posterUrl} alt={title} fill className="object-cover" sizes="33vw" />
        <div className="absolute top-1 right-1 h-5 w-5 rounded-md bg-black/55 backdrop-blur-sm flex items-center justify-center text-white">
          {isTv ? <Tv className="h-3 w-3" strokeWidth={2} /> : <Film className="h-3 w-3" strokeWidth={2} />}
        </div>
      </div>
      <p className="mt-1.5 font-headline font-semibold text-[12px] lowercase tracking-tight line-clamp-1">{title}</p>
      {year && year !== 'N/A' && (
        <p className="cc-meta text-[10px] text-muted-foreground">{year}</p>
      )}
    </button>
  );
}
