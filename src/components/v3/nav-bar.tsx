'use client';

import type { ReactNode } from 'react';
import { Frost } from './frost';
import { cn } from '@/lib/utils';

/**
 * NavBar — frosted sticky bar with a large lowercase Bricolage title that
 * "collapses" on scroll: tint + blur + a hairline rule fade in once `scrolled`
 * (Phase 0.7 / v3). Eyebrow above the title, an optional trailing action
 * (e.g. AddBtn), and an optional top-right utility cluster (bell, theme, avatar).
 *
 * Mobile: sticky to the viewport top (sits under the status bar via safe-area
 * padding). Desktop (`md`): static — the floating top pill owns the top edge,
 * so the bar just flows in document order and never collides with it.
 */
interface NavBarProps {
  title: string;
  eyebrow?: ReactNode;
  trailing?: ReactNode;
  topRight?: ReactNode;
  scrolled?: boolean;
}

export function NavBar({ title, eyebrow, trailing, topRight, scrolled }: NavBarProps) {
  return (
    <div className="sticky top-0 z-20 md:static">
      <Frost
        tint={scrolled ? undefined : 'transparent'}
        blur={scrolled ? 22 : 0}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <div className="px-5 pb-3">
          {topRight && (
            <div className="flex items-center justify-end gap-1 pb-1">{topRight}</div>
          )}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              {eyebrow && <div className="cc-eyebrow mb-1.5">{eyebrow}</div>}
              <h1 className="font-headline font-bold text-[34px] leading-[0.98] tracking-tight lowercase text-foreground">
                {title}
              </h1>
            </div>
            {trailing}
          </div>
        </div>
        <div
          className={cn(
            'h-px bg-rule transition-opacity duration-200',
            scrolled ? 'opacity-100' : 'opacity-0'
          )}
        />
      </Frost>
    </div>
  );
}
