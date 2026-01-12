'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getRatingStyle } from '@/lib/utils';

interface RatingSliderProps {
  value: number | null;
  onChangeComplete: (value: number) => void; // Called only when user releases
  onClear?: () => void;
  disabled?: boolean;
  showClearButton?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function RatingSlider({
  value,
  onChangeComplete,
  onClear,
  disabled = false,
  showClearButton = true,
  size = 'md',
  label = 'Your Rating',
}: RatingSliderProps) {
  const [localValue, setLocalValue] = useState<number>(value ?? 5);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const hasChangedRef = useRef(false);
  const justFinishedDraggingRef = useRef(false);

  // Sync local value with prop when not dragging
  useEffect(() => {
    // Skip sync if we just finished dragging (prevents bounce-back)
    if (justFinishedDraggingRef.current) {
      justFinishedDraggingRef.current = false;
      return;
    }
    if (!isDragging && value !== null) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const calculateValue = useCallback((clientX: number) => {
    if (!sliderRef.current) return localValue;
    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Map 0-1 to 1-10, round to 1 decimal
    return Math.round((1 + percentage * 9) * 10) / 10;
  }, [localValue]);

  const handleStart = useCallback((clientX: number) => {
    if (disabled) return;
    setIsDragging(true);
    hasChangedRef.current = false;
    const newValue = calculateValue(clientX);
    setLocalValue(newValue);
  }, [disabled, calculateValue]);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging || disabled) return;
    hasChangedRef.current = true;
    const newValue = calculateValue(clientX);
    setLocalValue(newValue);
  }, [isDragging, disabled, calculateValue]);

  const handleEnd = useCallback(() => {
    if (!isDragging) return;
    // Mark that we just finished dragging to prevent bounce-back
    justFinishedDraggingRef.current = true;
    setIsDragging(false);
    // Only trigger save if value actually changed
    if (hasChangedRef.current || value !== localValue) {
      onChangeComplete(localValue);
    }
    hasChangedRef.current = false;
  }, [isDragging, localValue, value, onChangeComplete]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX);
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    handleStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  // Global event listeners for mouse
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX);
    };

    const handleGlobalMouseUp = () => {
      handleEnd();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleMove, handleEnd]);

  const handleQuickSelect = (num: number) => {
    if (disabled) return;
    setLocalValue(num);
    onChangeComplete(num);
  };

  // Get styles for current rating value (memoized for performance)
  const ratingStyle = useMemo(() => getRatingStyle(localValue), [localValue]);

  // Calculate fill percentage (1-10 mapped to 0-100%)
  const fillPercentage = ((localValue - 1) / 9) * 100;

  const sizeClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  return (
    <div className="space-y-3">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {value !== null && showClearButton && onClear && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={disabled}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-4">
        {/* Rating display */}
        <div className="flex items-center gap-1.5 min-w-[80px]">
          <Star className="h-5 w-5" style={{ ...ratingStyle.accent, fill: ratingStyle.accent.color }} />
          <span className={`font-bold ${textSizeClasses[size]} tabular-nums`} style={ratingStyle.accent}>
            {localValue.toFixed(1)}
          </span>
          <span className="text-muted-foreground text-sm">/10</span>
        </div>

        {/* Slider track */}
        <div
          ref={sliderRef}
          className={`flex-1 relative ${sizeClasses[size]} bg-secondary rounded-full cursor-pointer select-none touch-none ${disabled ? 'opacity-50' : ''}`}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleEnd}
        >
          {/* Fill */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${isDragging ? '' : 'transition-all duration-150'}`}
            style={{ width: `${fillPercentage}%`, ...ratingStyle.background }}
          />
          {/* Thumb */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-background border-2 border-foreground rounded-full shadow-lg ${
              isDragging ? 'scale-125' : 'transition-all duration-150'
            }`}
            style={{ left: `${fillPercentage}%` }}
          />
        </div>
      </div>

      {/* Quick select buttons */}
      <div className="flex gap-1.5 justify-between">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
          <button
            key={num}
            onClick={() => handleQuickSelect(num)}
            disabled={disabled}
            className={`flex-1 h-9 text-sm font-bold rounded-lg transition-all ${
              Math.round(localValue) === num
                ? 'bg-primary text-primary-foreground scale-105'
                : 'bg-secondary hover:bg-secondary/80 text-foreground'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );
}
