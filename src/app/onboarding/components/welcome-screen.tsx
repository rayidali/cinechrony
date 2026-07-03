'use client';

import { Popcorn } from 'lucide-react';
import { PosterWall } from '@/components/v3/poster-wall';
import { CtaButton } from '@/components/v3/onboarding-kit';
import { haptic } from '@/lib/haptics';

const APP_ICON = '/brand/cinechrony-icon.png';

/**
 * 001 · welcome — Phase 0.7 Wave 7. Poster wall + scrim, popcorn lockup, the
 * "movies are better with friends." promise, and the two doors: get started →
 * name, or "i have an account" → login. Theme-aware (light/dark) via the scrim.
 */
export function WelcomeScreen({
  onGetStarted,
  onLogin,
}: {
  onGetStarted: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <PosterWall />

      {/* top eyebrow */}
      <div className="relative z-[1] px-6 pt-safe">
        <div className="pt-7 text-center font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          est · 2025 · shared watchlists
        </div>
      </div>

      <div className="flex-1" />

      {/* content — sits in the scrim at the bottom */}
      <div className="relative z-[1] px-6 pb-safe">
        <div className="pb-6">
          <div className="mb-5 flex items-center gap-2.5">
            <img src={APP_ICON} alt="" className="h-9 w-9 rounded-[8px]" />
            <span className="font-headline text-[26px] font-bold lowercase tracking-[-0.02em]">
              cinechrony
            </span>
          </div>

          <h1
            className="m-0 font-headline text-[40px] font-bold leading-[0.98] tracking-[-0.03em] lowercase"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            movies are better with friends.
          </h1>
          <p className="mt-3 font-serif text-[16px] font-light italic text-muted-foreground">
            think beli, but for movies.
          </p>

          <div className="mt-7 space-y-1.5">
            <CtaButton label="get started" icon={Popcorn} onClick={onGetStarted} />
            <button
              onClick={() => {
                haptic('light');
                onLogin();
              }}
              className="w-full py-3 text-center font-ui text-[15px] font-semibold text-foreground transition-opacity active:opacity-60"
            >
              i have an account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
