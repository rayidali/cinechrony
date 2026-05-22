'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FabProps {
  onClick?: () => void;
  /** Lucide icon component — `Plus` for add / new list. */
  icon: LucideIcon;
  /** Lowercase label, e.g. "add", "new list". */
  label: string;
  ariaLabel?: string;
  /** Extra classes — e.g. `z-40` to sit a FAB under a drawer overlay. */
  className?: string;
}

/**
 * Floating action button — design system v2.
 *
 * The v1 brutalist yellow sticker is retired. The FAB now carries the brand
 * accent itself: a film-red pill with white text + icon, no border, and a
 * soft red-tinted lift (`shadow-fab`). One per screen, bottom-right.
 * See UX_PATTERNS.md — "The FAB, redesigned".
 */
export function Fab({ onClick, icon: Icon, label, ariaLabel, className }: FabProps) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={cn(
        'fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50',
        'h-12 px-[18px] rounded-full',
        'bg-primary text-white shadow-fab',
        'inline-flex items-center justify-center gap-2',
        'font-headline font-bold text-[13px] lowercase tracking-tight',
        'transition-transform duration-150 ease-out',
        'md:hover:-translate-y-0.5 active:scale-[0.97]',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} />
      <span>{label}</span>
    </button>
  );
}
