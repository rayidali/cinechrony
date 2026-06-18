'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

/**
 * GlassBtn — a translucent dark-glass control for use OVER imagery (Phase 0.7).
 * White glyph on blurred dark glass with a hairline white border. Used for
 * back / share / settings / add buttons on heroes and cover photos. 38px hit
 * target by default; pass `label` for a pill (e.g. "manage").
 *
 * `-webkit-backdrop-filter` is required for the WKWebView (Capacitor iOS).
 */
interface GlassBtnProps {
  icon: LucideIcon;
  onClick?: () => void;
  label?: string;
  ariaLabel?: string;
  size?: number;
  className?: string;
}

export function GlassBtn({ icon: Icon, onClick, label, ariaLabel, size = 38, className }: GlassBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick ? () => { haptic('light'); onClick(); } : undefined}
      aria-label={ariaLabel ?? label}
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 rounded-full border border-white/20 text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-transform active:scale-95',
        // Keep the 38px glass visual but pad the tap area to the 44px iOS min
        // via a transparent centered hit-slop (no layout/visual change).
        'before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[\'\']',
        className
      )}
      style={{
        height: size,
        minWidth: size,
        padding: label ? '0 14px' : 0,
        background: 'rgba(22,20,18,0.30)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
      }}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
      {label && (
        <span className="font-headline text-sm font-semibold lowercase tracking-tight">{label}</span>
      )}
    </button>
  );
}
