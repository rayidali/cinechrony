'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { getRatingStyle } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

/**
 * The v3 "drag to rate" control (F01/F02/F03 design). A big rating-coloured
 * number + a 10-segment bar. The WHOLE control is the drag surface — touch or
 * drag anywhere in the box and it registers, mapping the x-position (measured
 * against the bar's geometry) to 1.0–10.0 in 0.1 steps. The fill is proportional
 * so 8.5 reads as eight-and-a-half cells lit. Colour follows the app's red→green
 * rating system. `onChangeComplete` fires on release / tap — never mid-drag —
 * mirroring the old `RatingSlider` contract so callers persist once.
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
  const barRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const lastSnapped = useRef<number>(0);

  const shown = dragValue ?? value ?? 0;
  const style = getRatingStyle(shown > 0 ? shown : null);
  const fillColor = shown > 0 ? (style.accent.color as string) : 'var(--muted-foreground)';

  // Map any x to a rating using the BAR's box (so the fill aligns with the
  // finger even when the touch lands on the number row or the card padding).
  const valueFromClientX = useCallback((clientX: number): number => {
    const el = barRef.current;
    if (!el) return value ?? 1;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(10, Math.max(1, Math.round(frac * 10 * 10) / 10));
  }, [value]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    const v = valueFromClientX(e.clientX);
    lastSnapped.current = Math.round(v);
    setDragValue(v);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || disabled) return;
    const v = valueFromClientX(e.clientX);
    setDragValue(v);
    if (Math.round(v) !== lastSnapped.current) {
      lastSnapped.current = Math.round(v);
      haptic('selection');
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current || disabled) return;
    const v = valueFromClientX(e.clientX);
    draggingRef.current = false;
    setDragValue(null);
    haptic('light');
    onChangeComplete(v);
  };

  useEffect(() => {
    if (disabled) { draggingRef.current = false; setDragValue(null); }
  }, [disabled]);

  const content = (
    <>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="font-headline font-bold text-[34px] leading-none tabular-nums" style={{ color: fillColor }}>
            {shown > 0 ? shown.toFixed(1) : '–'}
          </span>
          <span className="font-headline font-semibold text-[15px] text-muted-foreground">/ 10</span>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          drag to rate
        </span>
      </div>

      <div ref={barRef} className="mt-3.5 flex gap-1">
        {Array.from({ length: 10 }).map((_, i) => {
          const segFill = Math.min(100, Math.max(0, (shown - i) * 100));
          return (
            <div key={i} className="flex-1 h-3 rounded-[3px] bg-foreground/10 overflow-hidden">
              <div className="h-full rounded-[3px]" style={{ width: `${segFill}%`, backgroundColor: fillColor }} />
            </div>
          );
        })}
      </div>
    </>
  );

  // The whole control is the drag surface (`touch-none` so a horizontal drag
  // rates instead of scrolling the sheet/drawer).
  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
  const base = `touch-none select-none ${disabled ? 'opacity-60' : 'cursor-pointer'}`;
  const surfaceProps = {
    role: 'slider' as const,
    'aria-valuemin': 1,
    'aria-valuemax': 10,
    'aria-valuenow': shown > 0 ? shown : undefined,
    'aria-label': 'Your rating',
  };

  if (!framed) return <div {...handlers} {...surfaceProps} className={base}>{content}</div>;
  return (
    <div {...handlers} {...surfaceProps} className={`rounded-2xl border border-hair bg-card p-4 shadow-press ${base}`}>
      {content}
    </div>
  );
}
