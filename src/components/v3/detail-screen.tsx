'use client';

import { useEffect, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { haptic } from '@/lib/haptics';

/**
 * DetailScreen — the shared full-screen "pushed screen" shell for the v3
 * rail/thread detail destinations (Phase 0.7 F-screens: F15 dig-in›all,
 * F16 top-watchers›all, F17 community›all, …).
 *
 * A fixed overlay (z-[70], above the bottom nav, like `SearchOverlay`) with a
 * back-chevron header (film-red, per the mocks) and a centered lowercase title.
 * Rendered at the page root **outside `PullToRefresh`** — a CSS transform on an
 * ancestor breaks `position: fixed` descendants (the documented drawer/refresh
 * trap), and it locks body scroll while open. Movie drawers opened from inside a
 * DetailScreen must stack ABOVE it (pass `stackClassName="z-[80]"`).
 */
export function DetailScreen({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col animate-fade-in">
      <div
        className="flex items-center gap-2 px-4 border-b border-hair/70"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)',
          paddingBottom: '0.625rem',
        }}
      >
        <button
          onClick={() => {
            haptic('light');
            onClose();
          }}
          aria-label="Back"
          className="flex h-9 w-9 -ml-1.5 flex-shrink-0 items-center justify-center rounded-full text-primary transition-transform active:scale-90"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-center pr-7 font-headline font-bold text-[17px] lowercase tracking-[-0.02em] text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
