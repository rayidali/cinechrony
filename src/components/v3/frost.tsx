'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Frost — a frosted-glass surface (Phase 0.7 / v3 iOS-native kit).
 *
 * Renders a translucent, blurred backdrop tinted with a theme token, with
 * content layered on top. Maps to iOS's `UIBlurEffect` material. Used by the
 * tab bar, top bar, and nav bar.
 *
 * The blur is split into its own absolutely-positioned layer (rather than put
 * on the element directly) so the tint composites correctly and the children
 * never inherit the filter. `-webkit-backdrop-filter` is required — WKWebView
 * (the Capacitor iOS shell) does not honor the unprefixed property.
 *
 * Tint defaults to `--cc-chrome` (the nav/top-bar token); pass `--cc-tab-tint`
 * for the floating tab bar. Both are theme-aware (defined in :root and .dark)
 * and already carry their alpha, so they're used as-is, not via Tailwind.
 */
interface FrostProps {
  children: ReactNode;
  className?: string;
  /** CSS color for the tint layer. Defaults to the `--cc-chrome` token. */
  tint?: string;
  /** Blur radius in px. */
  blur?: number;
  style?: CSSProperties;
}

export function Frost({ children, className, tint, blur = 22, style }: FrostProps) {
  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backdropFilter: `blur(${blur}px) saturate(180%)`,
          WebkitBackdropFilter: `blur(${blur}px) saturate(180%)`,
          background: tint ?? 'var(--cc-chrome)',
        }}
      />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
