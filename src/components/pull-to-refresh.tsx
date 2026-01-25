'use client';

import { useState, useRef, useCallback, ReactNode } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type PullToRefreshProps = {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
};

const PULL_THRESHOLD = 80; // pixels to pull before triggering refresh
const MAX_PULL = 120; // maximum pull distance

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only enable pull-to-refresh when scrolled to top
    const container = containerRef.current;
    if (!container || window.scrollY > 0 || isRefreshing) return;

    startY.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    // Only allow pulling down
    if (diff > 0 && window.scrollY === 0) {
      // Apply resistance - pull distance decreases as you pull more
      const resistance = Math.min(diff * 0.5, MAX_PULL);
      setPullDistance(resistance);

      // Prevent default scrolling when pulling
      if (diff > 10) {
        e.preventDefault();
      }
    }
  }, [isPulling, isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;

    setIsPulling(false);

    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(60); // Keep some distance while refreshing

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [isPulling, pullDistance, isRefreshing, onRefresh]);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const shouldTrigger = pullDistance >= PULL_THRESHOLD;

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex justify-center overflow-hidden pointer-events-none z-50"
        style={{
          top: -60,
          height: pullDistance > 0 || isRefreshing ? pullDistance + 60 : 0,
          transition: isPulling ? 'none' : 'height 0.2s ease-out',
        }}
      >
        <div
          className={cn(
            'flex items-end pb-3 transition-opacity',
            pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'
          )}
        >
          {isRefreshing ? (
            <div className="flex items-center gap-2 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">Refreshing...</span>
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center gap-2 transition-colors',
                shouldTrigger ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <ArrowDown
                className={cn(
                  'h-5 w-5 transition-transform',
                  shouldTrigger && 'rotate-180'
                )}
                style={{
                  transform: `rotate(${progress * 180}deg)`,
                }}
              />
              <span className="text-sm font-medium">
                {shouldTrigger ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Content with transform */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
