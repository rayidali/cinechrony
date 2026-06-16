'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { getRatingStyle } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

/**
 * The v3 "drag to rate" control (F01/F02/F03 design). A big rating-coloured
 * number + a 10-segment bar you drag across (or tap) to set 1.0–10.0 in 0.1
 * steps. The segment fill is proportional so 8.5 reads as eight-and-a-half
 * cells lit. Colour follows the app's red→green rating system
 * (`getRatingStyle`). `onChangeComplete` fires on release / tap — never
 * mid-drag — mirroring the old `RatingSlider` contract so callers persist once.
 */
export function DragToRate({
  value,
  onChangeComplete,
  disabled = false,
  framed = true,
}: {
  value: number | null;
  onChangeComplete: (value: number) => void;
  disabled?: boolean;
  /** Wrap in the bordered card (drawer). F03 sheet passes false (bare). */
  framed?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastSnapped = useRef<number>(0);

  // While dragging we show the live value; otherwise the persisted one.
  const shown = dragValue ?? value ?? 0;
  const style = getRatingStyle(shown > 0 ? shown : null);
  const fillColor = shown > 0 ? (style.accent.color as string) : 'var(--muted-foreground)';

  const valueFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // 0.1 steps, clamped to the 1–10 rating domain.
    return Math.min(10, Math.max(1, Math.round(frac * 10 * 10) / 10));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    const v = valueFromClientX(e.clientX);
    lastSnapped.current = Math.round(v);
    setDragValue(v);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    const v = valueFromClientX(e.clientX);
    setDragValue(v);
    // Light tick as the bar crosses each whole-number segment.
    if (Math.round(v) !== lastSnapped.current) {
      lastSnapped.current = Math.round(v);
      haptic('selection');
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    const v = valueFromClientX(e.clientX);
    setDragging(false);
    setDragValue(null);
    haptic('light');
    onChangeComplete(v);
  };

  // Belt-and-suspenders: clear transient drag state if disabled flips.
  useEffect(() => {
    if (disabled) {
      setDragging(false);
      setDragValue(null);
    }
  }, [disabled]);

  const body = (
    <>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-headline font-bold text-[34px] leading-none tabular-nums"
            style={{ color: fillColor }}
          >
            {shown > 0 ? shown.toFixed(1) : '–'}
          </span>
          <span className="font-headline font-semibold text-[15px] text-muted-foreground">/ 10</span>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          drag to rate
        </span>
      </div>

      {/* 10-segment bar — proportional fill, drag or tap to set. */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`mt-3.5 flex gap-1 ${disabled ? 'opacity-60' : 'cursor-pointer'} touch-none select-none`}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={shown > 0 ? shown : undefined}
        aria-label="Your rating"
      >
        {Array.from({ length: 10 }).map((_, i) => {
          const segFill = Math.min(100, Math.max(0, (shown - i) * 100));
          return (
            <div key={i} className="flex-1 h-2.5 rounded-[3px] bg-foreground/10 overflow-hidden">
              <div
                className="h-full rounded-[3px] transition-[width] duration-75"
                style={{ width: `${segFill}%`, backgroundColor: fillColor }}
              />
            </div>
          );
        })}
      </div>
    </>
  );

  if (!framed) return <div>{body}</div>;
  return <div className="rounded-2xl border border-hair bg-card p-4 shadow-press">{body}</div>;
}
