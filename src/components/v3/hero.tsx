'use client';

import type { ReactNode } from 'react';

/**
 * Hero — full-bleed cinematic header (Phase 0.7). Renders a cover image (or a
 * deterministic gradient when none), a soft sheen + bottom scrim, glass chrome
 * slots (top-left / top-right), and bottom content (eyebrow + title). Reused by
 * List detail and Profile so the cinematic language stays identical.
 *
 * The chrome row clears the status bar via safe-area padding (native); content
 * is read white over the scrim.
 */
const GRADIENTS: [string, string][] = [
  ['#c8543c', '#5a1f17'],
  ['#3a3a85', '#1b1b46'],
  ['#2f6b4a', '#143324'],
  ['#5c4a37', '#2b2218'],
  ['#7a3360', '#3e1731'],
  ['#3e6275', '#1a2c36'],
  ['#8a5a2b', '#3d2510'],
  ['#4a3a72', '#1f163d'],
];

/** Deterministic per-seed cover gradient — shared so previews (e.g. the
 *  edit-profile sheet) match the live Hero exactly. */
export function gradientFromSeed(seed?: string): string {
  const s = seed && seed.length ? seed : 'cinechrony';
  const i = s.charCodeAt(0) + s.length;
  const [a, b] = GRADIENTS[i % GRADIENTS.length];
  return `linear-gradient(160deg, ${a}, ${b})`;
}

interface HeroProps {
  /** Custom cover image; falls back to a seeded gradient when absent. */
  coverImageUrl?: string;
  /** Seed for the fallback gradient (e.g. the list/profile name). */
  seed?: string;
  height?: number;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** Shown centered when there is no cover image (overrides the name ghost) —
   *  e.g. an "add a profile photo" affordance. Receives pointer events. */
  placeholder?: ReactNode;
  children?: ReactNode;
}

export function Hero({ coverImageUrl, seed, height = 300, topLeft, topRight, placeholder, children }: HeroProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: gradientFromSeed(seed) }} />
      )}
      {/* sheen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 80% at 75% 12%, rgba(255,255,255,0.16), transparent 52%)',
        }}
      />
      {/* faint title ghost — a giant lowercase echo of the name fills the
          space behind the content (design: ios-screens.jsx Hero). Only over a
          gradient with no explicit placeholder; a real cover speaks for itself. */}
      {!coverImageUrl && !placeholder && seed && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-6"
        >
          <span
            className="break-words text-center font-headline font-bold lowercase text-white/[0.10]"
            style={{
              fontSize: 'clamp(68px, 22vw, 104px)',
              lineHeight: 0.84,
              letterSpacing: '-0.05em',
              fontVariationSettings: '"wdth" 86',
            }}
          >
            {seed}
          </span>
        </div>
      )}
      {/* bottom scrim for legible white content */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.30) 0%, transparent 30%, transparent 52%, rgba(0,0,0,0.70) 100%)',
        }}
      />
      {/* empty-state placeholder (e.g. add-photo) — above the scrim so it's
          legible + tappable; only when there's no cover image. */}
      {!coverImageUrl && placeholder && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center px-6">{placeholder}</div>
      )}
      {/* top chrome */}
      <div
        className="absolute left-4 right-4 z-10 flex items-center justify-between"
        style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <div className="flex items-center gap-2">{topLeft}</div>
        <div className="flex items-center gap-2">{topRight}</div>
      </div>
      {/* bottom content */}
      <div className="absolute inset-x-5 bottom-4 z-10">{children}</div>
    </div>
  );
}
