'use client';

import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AddBtn — the native round film-red "+" (Phase 0.7 / v3).
 *
 * Replaces the v2 brutalist/pill FAB. Lives in a NavBar trailing slot or over
 * imagery. Soft red lift via `shadow-fab`.
 */
interface AddBtnProps {
  onClick?: () => void;
  size?: number;
  className?: string;
  label?: string;
}

export function AddBtn({ onClick, size = 34, className, label = 'add' }: AddBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-fab transition-transform active:scale-95',
        className
      )}
      style={{ width: size, height: size }}
    >
      <Plus className="h-5 w-5" strokeWidth={2.6} />
    </button>
  );
}
