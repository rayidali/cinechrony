'use client';

import { cn } from '@/lib/utils';

/**
 * Segmented — iOS sliding-pill segmented control (Phase 0.7 / v3).
 *
 * A sunken track with a single pill thumb that animates between segments.
 * Active label is ink + semibold, inactive is muted. Generic over string ids.
 */
export interface SegmentedOption {
  id: string;
  label: string;
}

interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Segmented({ options, value, onChange, className }: SegmentedProps) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const pct = 100 / options.length;

  return (
    <div
      role="tablist"
      className={cn(
        'relative flex p-0.5 rounded-[11px] bg-sunken border border-hair',
        className
      )}
    >
      {/* sliding thumb */}
      <div
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-[9px] bg-[oklch(0.995_0_0)] dark:bg-[oklch(0.34_0.012_60)] shadow-press"
        style={{
          left: `calc(${pct * index}% + 2px)`,
          width: `calc(${pct}% - 4px)`,
          transition: 'left 0.28s cubic-bezier(0.34, 1.4, 0.5, 1)',
        }}
      />
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              'relative z-[1] flex-1 h-[30px] text-[13px] tracking-tight lowercase transition-colors',
              active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
