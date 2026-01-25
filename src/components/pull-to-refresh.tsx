'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type PullToRefreshProps = {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
  /** Disable pull-to-refresh (e.g., when a modal is open) */
  disabled?: boolean;
};

const PULL_THRESHOLD = 70; // pixels to pull before triggering refresh
const MAX_PULL = 130; // maximum pull distance
const DIRECTION_LOCK_THRESHOLD = 10; // pixels to determine scroll direction

export function PullToRefresh({
  onRefresh,
  children,
  className,
  disabled = false,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const isPulling = useRef(false);
  const isDirectionLocked = useRef(false);
  const isVerticalScroll = useRef(false);

  // Check if we're at the top of the page
  const isAtTop = useCallback(() => {
    // Check both window scroll and any scrollable parent
    if (window.scrollY > 0) return false;

    // Also check if any parent is scrolled
    let element = containerRef.current?.parentElement;
    while (element) {
      if (element.scrollTop > 0) return false;
      element = element.parentElement;
    }

    return true;
  }, []);

  // Use native event listeners for non-passive touch handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (disabled || isRefreshing || !isAtTop()) return;

      const touch = e.touches[0];
      startY.current = touch.clientY;
      startX.current = touch.clientX;
      isPulling.current = true;
      isDirectionLocked.current = false;
      isVerticalScroll.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing || disabled) return;

      const touch = e.touches[0];
      const deltaY = touch.clientY - startY.current;
      const deltaX = touch.clientX - startX.current;

      // Lock direction after moving past threshold
      if (!isDirectionLocked.current && (Math.abs(deltaY) > DIRECTION_LOCK_THRESHOLD || Math.abs(deltaX) > DIRECTION_LOCK_THRESHOLD)) {
        isDirectionLocked.current = true;
        // Determine if this is primarily a vertical scroll
        isVerticalScroll.current = Math.abs(deltaY) > Math.abs(deltaX);
      }

      // Only handle vertical pulls downward
      if (!isDirectionLocked.current || !isVerticalScroll.current || deltaY <= 0) {
        return;
      }

      // Double-check we're at the top (handles edge cases)
      if (!isAtTop()) {
        isPulling.current = false;
        setPullDistance(0);
        return;
      }

      // Prevent default scroll behavior when pulling
      e.preventDefault();

      // Apply exponential resistance - feels more natural
      const resistance = 0.4;
      const pullAmount = Math.min(deltaY * resistance, MAX_PULL);
      setPullDistance(pullAmount);
    };

    const handleTouchEnd = async () => {
      if (!isPulling.current) return;

      isPulling.current = false;
      isDirectionLocked.current = false;

      const currentPull = pullDistance;

      if (currentPull >= PULL_THRESHOLD && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(50); // Keep indicator visible while refreshing

        // Haptic feedback if available
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }

        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    // Add event listeners with { passive: false } to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isRefreshing, disabled, onRefresh, pullDistance, isAtTop]);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const shouldTrigger = pullDistance >= PULL_THRESHOLD;

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={{
        // Prevent browser's native pull-to-refresh
        overscrollBehaviorY: 'contain',
      }}
    >
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex justify-center items-center pointer-events-none z-50"
        style={{
          top: 0,
          height: pullDistance,
          transition: isPulling.current ? 'none' : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {(pullDistance > 0 || isRefreshing) && (
          <div className="flex flex-col items-center gap-1">
            {/* Spinner / Progress indicator */}
            <div
              className={cn(
                'rounded-full p-2 transition-all duration-200',
                shouldTrigger || isRefreshing
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              )}
              style={{
                transform: `scale(${0.7 + progress * 0.3})`,
              }}
            >
              <Loader2
                className={cn(
                  'h-5 w-5',
                  isRefreshing && 'animate-spin'
                )}
                style={{
                  transform: !isRefreshing ? `rotate(${progress * 360}deg)` : undefined,
                  transition: isPulling.current ? 'none' : 'transform 0.2s ease-out',
                }}
              />
            </div>

            {/* Status text */}
            <span
              className={cn(
                'text-xs font-medium transition-opacity duration-200',
                pullDistance > 30 ? 'opacity-100' : 'opacity-0',
                shouldTrigger || isRefreshing ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {isRefreshing
                ? 'Refreshing...'
                : shouldTrigger
                  ? 'Release to refresh'
                  : 'Pull to refresh'
              }
            </span>
          </div>
        )}
      </div>

      {/* Content with transform */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling.current ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
