'use client';

import Image from 'next/image';
import { Instagram, Youtube } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { TiktokIcon } from '@/components/icons';
import { parseVideoUrl } from '@/lib/video-utils';
import { seededGradient } from '@/lib/seeded-gradient';
import { haptic } from '@/lib/haptics';
import type { Movie } from '@/lib/types';

/**
 * One film waiting in the unfiled pen (Phase D2,
 * `../design-refs-2026-08/screens/01-unfiled-inbox.png`).
 *
 * PURPOSE-BUILT RATHER THAN `MovieCellRow`. The first cut reused that component
 * and it was wrong in a way only a screenshot showed: `MovieCellRow` renders its
 * own card, so the `file` button ended up floating OUTSIDE the card as a
 * detached control, and its "to watch" status chip is pure noise in a bucket
 * where every film is to-watch by definition. The pen's row is a plain row —
 * poster, name, where it came from, one verb.
 *
 * The meta line answers "what is this and how long has it been sitting here",
 * which is the question the screen exists to provoke. Genre is deliberately
 * absent: it is not on the movie doc, and inventing a lookup for it would cost
 * a TMDB read per row on a screen whose whole job is to be emptied.
 */

function providerIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  switch (parsed?.provider) {
    case 'tiktok': return TiktokIcon;
    case 'instagram': return Instagram;
    case 'youtube': return Youtube;
    default: return null;
  }
}

export function UnfiledRow({
  movie,
  busy,
  onFile,
}: {
  movie: Movie;
  busy?: boolean;
  onFile: () => void;
}) {
  const Provider = providerIcon(movie.socialLink);
  const added = movie.createdAt instanceof Date && !Number.isNaN(movie.createdAt.getTime())
    ? formatDistanceToNowStrict(movie.createdAt, { addSuffix: false })
      // "2 days" → "2d", matching the mono tabular voice used elsewhere.
      .replace(/\s*seconds?$/, 's').replace(/\s*minutes?$/, 'm')
      .replace(/\s*hours?$/, 'h').replace(/\s*days?$/, 'd')
      .replace(/\s*months?$/, 'mo').replace(/\s*years?$/, 'y')
    : null;

  return (
    <div className="flex items-center gap-3.5 py-3">
      <div className="relative h-[72px] w-12 flex-shrink-0 overflow-hidden rounded-[10px] bg-sunken">
        {movie.posterUrl ? (
          <Image src={movie.posterUrl} alt="" fill className="object-cover" sizes="48px" unoptimized />
        ) : (
          <div className="absolute inset-0" style={{ background: seededGradient(movie.id) }} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-headline font-bold text-[17px] lowercase leading-tight truncate">
          {movie.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
          {movie.year && <span>{movie.year}</span>}
          {Provider && (
            <>
              {movie.year && <span aria-hidden>·</span>}
              <Provider className="h-3 w-3" />
            </>
          )}
          {added && (
            <>
              <span aria-hidden>·</span>
              <span>{added} ago</span>
            </>
          )}
        </div>
      </div>

      <button
        disabled={busy}
        onClick={() => { haptic('light'); onFile(); }}
        className="flex-shrink-0 rounded-full border border-border px-4 py-2 font-ui font-semibold text-[13px] lowercase active:opacity-60 disabled:opacity-40 transition-opacity"
      >
        file
      </button>
    </div>
  );
}
