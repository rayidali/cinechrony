'use client';

import { useMemo } from 'react';
import { getDigIn, type DigInData, type DigInCategory } from '@/lib/tmdb-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { Section } from '@/components/v3/section';
import type { SearchResult } from '@/lib/types';

/**
 * "dig in" — top-picks category shelves (Phase 0.7 / v3, `ios-home.jsx::TopPicks`).
 *
 * Four real TMDB categories rendered as fanned poster collages with a colored
 * dot. Tapping a shelf opens its top film for now (the F15 category grid is a
 * later slice). All client-direct TMDB — no server round-trip.
 */
const CATS: {
  key: DigInCategory;
  dot: string; // brand accent (design ACCENTS), oklch constants
  sub: string;
}[] = [
  { key: 'new', dot: 'oklch(0.52 0.11 150)', sub: 'fresh logs' },
  { key: 'trending', dot: 'oklch(0.78 0.13 78)', sub: "everyone's watching" },
  { key: 'popular', dot: 'oklch(0.62 0.18 33)', sub: 'all-time loved' },
  { key: 'lowkey', dot: 'oklch(0.55 0.14 300)', sub: 'hidden gems' },
];

export function DigIn() {
  const { openMovie } = useMovieModal();
  const { data } = useCachedAction<DigInData>('home-dig-in', () => getDigIn(6));

  const cats = useMemo(
    () => CATS.map((c) => ({ ...c, films: data?.[c.key] ?? [] })),
    [data],
  );

  const hasAny = cats.some((c) => c.films.length > 0);
  if (data && !hasAny) return null;

  const openFilm = (f: SearchResult) =>
    openMovie({
      id: `digin_${f.tmdbId}`,
      title: f.title,
      year: f.year,
      posterUrl: f.posterUrl,
      posterHint: f.posterHint,
      addedBy: '',
      status: 'To Watch',
      mediaType: f.mediaType,
      tmdbId: f.tmdbId,
    });

  return (
    <section>
      <Section
        eyebrow="top picks"
        title="dig in"
        trailing={<span className="font-ui font-semibold text-[13px] text-primary">view all</span>}
        className="mb-3"
      />
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {cats.map((c) => (
          <button
            key={c.key}
            onClick={() => c.films[0] && openFilm(c.films[0])}
            className="flex-shrink-0 w-[124px] text-left"
          >
            <div className="relative aspect-[3/4] rounded-[15px] bg-sunken overflow-hidden">
              <PosterFan posters={c.films.slice(0, 3).map((f) => f.posterUrl)} />
              {c.films.length > 0 && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm font-mono text-[9px] font-bold text-white tabular-nums">
                  {c.films.length} films
                </span>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-[7px]">
              <span className="w-[9px] h-[9px] rounded-full flex-shrink-0" style={{ background: c.dot }} />
              <span className="font-headline font-bold text-[15px] lowercase tracking-[-0.02em] text-foreground">
                {c.key}
              </span>
            </div>
            <span className="block font-mono text-[10px] text-muted-foreground mt-[3px]">{c.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Three posters fanned into a shelf — center upright, sides tilted behind. */
function PosterFan({ posters }: { posters: string[] }) {
  const [front, left, right] = posters;
  const items = [
    left ? { src: left, rot: -13, x: '-30%', z: 1 } : null,
    right ? { src: right, rot: 13, x: '30%', z: 1 } : null,
    front ? { src: front, rot: 0, x: '0%', z: 2 } : null,
  ].filter(Boolean) as { src: string; rot: number; x: string; z: number }[];

  if (items.length === 0) return null;

  return (
    <>
      {items.map((it, k) => (
        <span
          key={k}
          className="absolute left-1/2 top-1/2 w-[58%] aspect-[2/3] rounded-[8px] overflow-hidden border-[0.5px] border-black/25 shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
          style={{
            transform: `translate(-50%,-50%) translateX(${it.x}) rotate(${it.rot}deg)`,
            zIndex: it.z,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.src} alt="" className="w-full h-full object-cover" />
        </span>
      ))}
    </>
  );
}
