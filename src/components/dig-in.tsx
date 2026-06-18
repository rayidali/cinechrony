'use client';

import { useMemo } from 'react';
import { getDigIn, type DigInData, type DigInCategory } from '@/lib/tmdb-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { Section, ViewAll } from '@/components/v3/section';

/**
 * "dig in" — top-picks category shelves (Phase 0.7 / v3, `ios-home.jsx::TopPicks`).
 *
 * Four real TMDB categories rendered as fanned poster collages with a colored
 * dot. Tapping a shelf (or "view all") opens the F15 dig-in grid on that
 * category. All client-direct TMDB — no server round-trip.
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

/**
 * Shared dig-in fetch — 20 per category, cached for the session. The home rail
 * (3-poster collage) and the F15 "view all" grid both read this one cache, so
 * the rail's film count matches the grid and there's no double fetch.
 */
export function useDigIn() {
  return useCachedAction<DigInData>('home-dig-in', () => getDigIn(20), { staleTime: 900_000 }); // TMDB shelves — 15 min
}

export function DigIn({ onViewAll }: { onViewAll?: (cat?: DigInCategory) => void }) {
  const { data } = useDigIn();

  const cats = useMemo(
    () => CATS.map((c) => ({ ...c, films: data?.[c.key] ?? [] })),
    [data],
  );

  const hasAny = cats.some((c) => c.films.length > 0);
  if (data && !hasAny) return null;

  return (
    <section>
      <Section
        eyebrow="top picks"
        title="dig in"
        trailing={<ViewAll onTap={onViewAll ? () => onViewAll() : undefined} />}
        className="mb-3.5"
      />
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-[18px] px-[18px] pb-1">
        {cats.map((c) => (
          <button
            key={c.key}
            onClick={() => onViewAll?.(c.key)}
            className="flex-shrink-0 w-[124px] text-left"
          >
            <div className="relative aspect-[3/4] rounded-[15px] bg-sunken overflow-hidden">
              <PosterFan posters={c.films.slice(0, 3).map((f) => f.posterUrl)} />
              {c.films.length > 0 && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm font-mono text-[10px] font-bold text-white tabular-nums">
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
