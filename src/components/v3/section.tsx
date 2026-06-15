'use client';

import type { ReactNode } from 'react';

/**
 * Section header — Phase 0.7 / v3 (`ios-kit.jsx::Section`).
 *
 * Eyebrow (Space Mono uppercase) → lowercase Bricolage title (22px, wdth 95)
 * with an optional trailing slot ("view all", a live dot, etc). Matches the
 * design's exact metrics so every home rail + the reel share one rhythm.
 */
export function Section({
  eyebrow,
  title,
  trailing,
  className,
}: {
  eyebrow?: string;
  title: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && (
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-[9px]">
          {eyebrow}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="m-0 font-headline font-bold text-[22px] tracking-[-0.03em] lowercase text-foreground"
          style={{ fontVariationSettings: '"wdth" 95' }}
        >
          {title}
        </h2>
        {trailing}
      </div>
    </div>
  );
}
