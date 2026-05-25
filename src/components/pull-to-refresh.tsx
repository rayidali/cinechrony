'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type PullToRefreshProps = {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
  /** Disable pull-to-refresh (e.g., when a modal is open). */
  disabled?: boolean;
};

const PULL_THRESHOLD = 70; // pixels to pull before triggering refresh
const MAX_PULL = 130; // maximum pull distance
const DIRECTION_LOCK_THRESHOLD = 10; // pixels to determine scroll direction
const RESISTANCE = 0.4; // exponential drag — feels more natural than linear

/**
 * Pull-to-refresh container.
 *
 * Listeners are bound ONCE on mount via stable refs for prop / state values.
 * The previous implementation included `pullDistance` in the effect's deps,
 * which detached and re-attached the listeners on every touchmove frame —
 * burning CPU and risking stale handlers mid-gesture. Now only the render
 * state mutates via setState; gesture math reads/writes refs.
 *
 * The content wrapper only attaches a `transform` while actually pulling or
 * refreshing. A non-zero transform on a wrapper creates a CSS containing
 * block, which breaks `position: sticky` and `position: fixed` for
 * descendants — see `body-style-watchdog.tsx` for the round-trip that bit us.
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
  disabled = false,
}: PullToRefreshProps) {
  // Render state.
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActivelyPulling, setIsActivelyPulling] = useState(false);

  // Refs that mirror props/state for the listeners (so the effect doesn't
  // re-bind on every change).
  const containerRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const onRefreshRef = useRef(onRefresh);
  const isRefreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Per-gesture scratch — local to the listeners.
    let startY = 0;
    let startX = 0;
    let isPulling = false;
    let directionLocked = false;
    let verticalScroll = false;

    const isAtTop = () => {
      if (window.scrollY > 0) return false;
      let element = container.parentElement;
      while (element) {
        if (element.scrollTop > 0) return false;
        element = element.parentElement;
      }
      return true;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || isRefreshingRef.current || !isAtTop()) return;
      const touch = e.touches[0];
      if (!touch) return;
      startY = touch.clientY;
      startX = touch.clientX;
      isPulling = true;
      directionLocked = false;
      verticalScroll = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling || isRefreshingRef.current || disabledRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - startY;
      const deltaX = touch.clientX - startX;

      // Lock direction once the user has clearly committed to one axis.
      if (
        !directionLocked &&
        (Math.abs(deltaY) > DIRECTION_LOCK_THRESHOLD ||
          Math.abs(deltaX) > DIRECTION_LOCK_THRESHOLD)
      ) {
        directionLocked = true;
        verticalScroll = Math.abs(deltaY) > Math.abs(deltaX);
      }

      if (!directionLocked || !verticalScroll || deltaY <= 0) return;

      // If the user scrolled out of the top while pulling, abort.
      if (!isAtTop()) {
        isPulling = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        setIsActivelyPulling(false);
        return;
      }

      if (e.cancelable) e.preventDefault();

      const pullAmount = Math.min(deltaY * RESISTANCE, MAX_PULL);
      pullDistanceRef.current = pullAmount;
      setPullDistance(pullAmount);
      setIsActivelyPulling(true);
    };

    const handleTouchEnd = async () => {
      if (!isPulling) return;
      isPulling = false;
      directionLocked = false;
      setIsActivelyPulling(false);

      const currentPull = pullDistanceRef.current;

      if (currentPull >= PULL_THRESHOLD && !isRefreshingRef.current) {
        setIsRefreshing(true);
        pullDistanceRef.current = 50;
        setPullDistance(50);

        if ('vibrate' in navigator) {
          try {
            navigator.vibrate(10);
          } catch {
            /* some browsers throw on noisy use — ignore */
          }
        }

        try {
          await onRefreshRef.current();
        } finally {
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

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
    // Bind once — refs above feed the latest values into the closure.
  }, []);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const shouldTrigger = pullDistance >= PULL_THRESHOLD;

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={{
        // Prevent browser's native pull-to-refresh from layering on top.
        overscrollBehaviorY: 'contain',
      }}
    >
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex justify-center items-center pointer-events-none z-50"
        style={{
          top: 0,
          height: pullDistance,
          transition: isActivelyPulling
            ? 'none'
            : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {(pullDistance > 0 || isRefreshing) && (
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'rounded-full p-2 transition-all duration-200',
                shouldTrigger || isRefreshing
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground',
              )}
              style={{ transform: `scale(${0.7 + progress * 0.3})` }}
            >
              <Loader2
                className={cn('h-5 w-5', isRefreshing && 'animate-spin')}
                style={{
                  transform: !isRefreshing
                    ? `rotate(${progress * 360}deg)`
                    : undefined,
                  transition: isActivelyPulling
                    ? 'none'
                    : 'transform 0.2s ease-out',
                }}
              />
            </div>

            <span
              className={cn(
                'text-xs font-medium transition-opacity duration-200',
                pullDistance > 30 ? 'opacity-100' : 'opacity-0',
                shouldTrigger || isRefreshing
                  ? 'text-primary'
                  : 'text-muted-foreground',
              )}
            >
              {isRefreshing
                ? 'Refreshing...'
                : shouldTrigger
                  ? 'Release to refresh'
                  : 'Pull to refresh'}
            </span>
          </div>
        )}
      </div>

      {/*
        Content shell.

        Only attach a `transform` while pulling or refreshing — a non-zero
        transform on this wrapper creates a CSS containing block, breaking
        `position: sticky` and `position: fixed` for every descendant.
      */}
      <div
        style={
          pullDistance > 0 || isRefreshing
            ? {
                transform: `translateY(${pullDistance}px)`,
                transition: isActivelyPulling
                  ? 'none'
                  : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
