'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FilterPill = {
  id: string;
  label: string;
  icon?: LucideIcon;
};

type FilterPillsProps = {
  pills: FilterPill[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

/**
 * The Home feed filter row — a horizontally-scrollable strip of mono pills.
 *
 * Active pill: cinema-ink fill, bone text. Built to grow: each Phase 0.5
 * feature adds its own pill (`saved`, `for you`, `trending`) as it lands.
 * See UX_PATTERNS.md — "Filter pills behavior".
 */
export function FilterPills({ pills, active, onChange, className }: FilterPillsProps) {
  return (
    <div
      className={cn(
        'flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4',
        className,
      )}
    >
      {pills.map((pill) => {
        const isActive = pill.id === active;
        const Icon = pill.icon;
        return (
          <button
            key={pill.id}
            onClick={() => onChange(pill.id)}
            aria-pressed={isActive}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
              'cc-meta text-[11px] lowercase border transition-colors duration-150',
              isActive
                ? 'bg-foreground text-background border-foreground'
                : 'bg-transparent text-muted-foreground border-border hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-3 w-3" strokeWidth={1.8} />}
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
