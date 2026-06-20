'use client';

import { useMemo } from 'react';
import { seededGradient } from '@/lib/seeded-gradient';
import { cn } from '@/lib/utils';

/**
 * PosterWall — the filmic backdrop for the welcome / login screens (Phase 0.7
 * Wave 7, screens 001 + 006). A quietly drifting grid of seeded poster tiles
 * under a vertical scrim that fades to the page background so content reads on
 * top. Network-free + instant (no TMDB call on the first screen the user ever
 * sees) and quota-safe — the muted gradient tiles match the design's desaturated
 * poster-wall look. Theme-aware via the `--background` scrim.
 */
export function PosterWall({
  className,
  rows = 5,
  cols = 4,
  seed = 'cinechrony',
}: {
  className?: string;
  rows?: number;
  cols?: number;
  seed?: string;
}) {
  const tiles = useMemo(
    () => Array.from({ length: rows * cols }, (_, i) => `${seed}-${i}-${(i * 7) % 13}`),
    [rows, cols, seed],
  );

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {/* The tilted poster grid */}
      <div
        className="cc-posterwall absolute inset-0 grid gap-2.5 p-2.5"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: '1fr',
          transform: 'scale(1.18) rotate(-4deg) translateY(-4%)',
          transformOrigin: 'center',
        }}
      >
        {tiles.map((s) => (
          <div
            key={s}
            className="rounded-[10px]"
            style={{
              background: seededGradient(s, 150),
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -30px 40px rgba(0,0,0,0.18)',
              opacity: 0.78,
            }}
          />
        ))}
      </div>

      {/* Scrim — desaturate + fade to the page background toward the bottom. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, oklch(var(--background) / 0.20) 0%, oklch(var(--background) / 0.55) 42%, oklch(var(--background) / 0.92) 74%, oklch(var(--background)) 100%)',
        }}
      />
    </div>
  );
}
