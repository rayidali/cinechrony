'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  /** Called when the user completes the back gesture. */
  onBack: () => void;
  /**
   * Disable the gesture (e.g. while a keyboard is up or a child sheet is
   * open). Touch listeners stay bound; they just no-op.
   */
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

const EDGE_ZONE = 30; // px from the left edge that arms the gesture
const LOCK_THRESHOLD = 10; // px to commit to horizontal vs vertical
const DISMISS_RATIO = 0.35; // fraction of viewport width to commit
const VELOCITY_THRESHOLD = 0.55; // px/ms — a fast flick commits even short
const DISMISS_MS = 240;

/**
 * iOS-style swipe-back gesture for full-screen routes.
 *
 * Touches starting within EDGE_ZONE of the left edge arm the gesture. If the
 * user moves right past LOCK_THRESHOLD and the motion is more horizontal
 * than vertical, we lock into a horizontal drag and translate the content in
 * real time. On release: commit (slide off + onBack) if dragged past
 * DISMISS_RATIO OR flicked fast; otherwise spring back to 0.
 *
 * Listeners are bound ONCE on mount via stable refs. The renderer-facing
 * state (`dragX`, `isDragging`) is React state; the per-gesture scratch
 * lives in `useRef` and closure-local variables so we don't re-bind on
 * every frame the way `PullToRefresh` used to.
 *
 * Should be used as the OUTER container of a full-screen page (replaces a
 * `fixed inset-0` wrapper). The transform creates a CSS containing block, so
 * don't nest other `position: fixed` descendants that need to escape it.
 */
export function SwipeBackContainer({ onBack, disabled, className, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Render state. dragX drives the transform; isDragging suppresses the
  // CSS transition while the finger is down.
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  // Stable refs so listeners bind once and still see latest prop values.
  const onBackRef = useRef(onBack);
  const disabledRef = useRef(!!disabled);
  const isDismissingRef = useRef(false);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);
  useEffect(() => {
    disabledRef.current = !!disabled;
  }, [disabled]);
  useEffect(() => {
    isDismissingRef.current = isDismissing;
  }, [isDismissing]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Per-gesture closure-local state. No need for refs since listeners
    // share the same lexical scope.
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lock: 'h' | 'v' | null = null;
    let active = false;
    let liveDx = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || isDismissingRef.current) return;
      // Only arm from the left edge so we don't fight horizontal scrollers,
      // tap targets, or any other UI deeper in the page.
      const t = e.touches[0];
      if (!t || t.clientX > EDGE_ZONE) return;
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp || performance.now();
      lock = null;
      active = true;
      liveDx = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lock) {
        if (Math.abs(dx) > LOCK_THRESHOLD || Math.abs(dy) > LOCK_THRESHOLD) {
          lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
          if (lock === 'h') setIsDragging(true);
        }
      }

      if (lock !== 'h') return;
      // No left-pull — only the right direction dismisses.
      const clamped = Math.max(0, dx);
      liveDx = clamped;
      // preventDefault stops iOS's own edge-swipe-back from also firing,
      // so we don't double-commit.
      if (e.cancelable) e.preventDefault();
      setDragX(clamped);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;

      if (lock !== 'h') {
        // Never engaged the horizontal drag — nothing to undo.
        return;
      }

      setIsDragging(false);

      const width = window.innerWidth || 375;
      const elapsed = Math.max((e.timeStamp || performance.now()) - startT, 1);
      const velocity = liveDx / elapsed;

      const commit = liveDx > width * DISMISS_RATIO || velocity > VELOCITY_THRESHOLD;
      if (commit) {
        // Light haptic on commit — matches the iOS gesture's feel and
        // confirms the dismiss before the route changes.
        if ('vibrate' in navigator) {
          try {
            navigator.vibrate(8);
          } catch {
            /* some browsers throw on noisy use — ignore */
          }
        }
        setIsDismissing(true);
        // Snap to off-screen and let the transition carry it. onBack fires
        // once the animation completes so the next route mounts during the
        // visual handoff, not before it.
        setDragX(width);
        window.setTimeout(() => {
          onBackRef.current();
        }, DISMISS_MS);
      } else {
        setDragX(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // Bind once. We read the latest disabled/onBack via refs so this is safe.
  }, []);

  const transform = dragX > 0 ? `translate3d(${dragX}px, 0, 0)` : undefined;
  // A soft drop-shadow on the trailing (left) edge sells the "lifted sheet"
  // feel during the drag. Hidden when at rest so we don't paint a static
  // shadow into normal usage.
  const shadow =
    dragX > 0 ? '-12px 0 32px rgba(0, 0, 0, 0.22)' : undefined;

  return (
    <div
      ref={containerRef}
      className={cn('fixed inset-0', className)}
      style={{
        transform,
        boxShadow: shadow,
        transition: isDragging
          ? 'none'
          : `transform ${DISMISS_MS}ms cubic-bezier(0.2, 0.8, 0.4, 1), box-shadow ${DISMISS_MS}ms ease-out`,
        // We translate on the X axis only; suggest to the browser to keep
        // this on its own layer for smooth animation.
        willChange: dragX > 0 ? 'transform' : undefined,
      }}
    >
      {children}
    </div>
  );
}
