'use client';

import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FabProps {
  onClick?: () => void;
  /** Optional long-press handler — opens a secondary action sheet. */
  onLongPress?: () => void;
  /** Lucide icon component — `Plus` for add / new list, `PencilLine` for post. */
  icon: LucideIcon;
  /** Lowercase label, e.g. "add", "new list", "post". */
  label: string;
  ariaLabel?: string;
  /** Extra classes — e.g. `z-40` to sit a FAB under a drawer overlay. */
  className?: string;
}

/**
 * Floating action button — design system v2.
 *
 * A film-red pill with white text + icon, no border, a soft red-tinted lift
 * (`shadow-fab`). One per screen, bottom-right. Long-press opens the
 * secondary action sheet (post composer FAB). See UX_PATTERNS.md.
 */
export function Fab({ onClick, onLongPress, icon: Icon, label, ariaLabel, className }: FabProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const startPress = () => {
    if (!onLongPress) return;
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, 480);
  };
  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const handleClick = () => {
    if (firedRef.current) {
      firedRef.current = false;
      return; // a long-press already handled this interaction
    }
    onClick?.();
  };

  return (
    <button
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
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
