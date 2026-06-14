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

function gradientFromSeed(seed?: string): string {
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
  children?: ReactNode;
}

export function Hero({ coverImageUrl, seed, height = 300, topLeft, topRight, children }: HeroProps) {
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
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 80% at 75% 12%, rgba(255,255,255,0.16), transparent 52%)',
        }}
      />
      {/* bottom scrim for legible white content */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.30) 0%, transparent 30%, transparent 52%, rgba(0,0,0,0.70) 100%)',
        }}
      />
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
