'use client';

import { useState, useEffect, useRef } from 'react';
import { Star, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RatingSliderProps {
  value: number | null;
  onChange: (value: number | null) => void;
  onSave?: () => void;
  isSaving?: boolean;
  showSaveButton?: boolean;
  showClearButton?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function RatingSlider({
  value,
  onChange,
  onSave,
  isSaving = false,
  showSaveButton = false,
  showClearButton = true,
  size = 'md',
  label = 'Your Rating',
}: RatingSliderProps) {
  const [localValue, setLocalValue] = useState<number>(value ?? 5);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Sync local value with prop
  useEffect(() => {
    if (value !== null) {
      setLocalValue(value);
    }
  }, [value]);

  const handleSliderChange = (clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Map 0-1 to 1-10
    const newValue = Math.round((1 + percentage * 9) * 10) / 10;
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleSliderChange(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleSliderChange(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleSliderChange(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      handleSliderChange(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleClear = () => {
    onChange(null);
  };

  // Get color based on rating
  const getRatingColor = (rating: number) => {
    if (rating >= 8) return 'text-green-500';
    if (rating >= 6) return 'text-yellow-500';
    if (rating >= 4) return 'text-orange-500';
    return 'text-red-500';
  };

  const getBgColor = (rating: number) => {
    if (rating >= 8) return 'bg-green-500';
    if (rating >= 6) return 'bg-yellow-500';
    if (rating >= 4) return 'bg-orange-500';
    return 'bg-red-500';
  };

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
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {value !== null && showClearButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={isSaving}
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
          <Star className={`h-5 w-5 fill-current ${getRatingColor(localValue)}`} />
          <span className={`font-bold ${textSizeClasses[size]} ${getRatingColor(localValue)}`}>
            {localValue.toFixed(1)}
          </span>
          <span className="text-muted-foreground text-sm">/10</span>
        </div>

        {/* Slider track */}
        <div
          ref={sliderRef}
          className={`flex-1 relative ${sizeClasses[size]} bg-secondary rounded-full cursor-pointer select-none`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Fill */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-75 ${getBgColor(localValue)}`}
            style={{ width: `${fillPercentage}%` }}
          />
          {/* Thumb */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-background border-2 border-foreground rounded-full shadow-md transition-all duration-75 ${
              isDragging ? 'scale-110' : ''
            }`}
            style={{ left: `${fillPercentage}%` }}
          />
        </div>

        {/* Save button */}
        {showSaveButton && onSave && (
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving || value === localValue}
            className="h-8"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Save'
            )}
          </Button>
        )}
      </div>

      {/* Quick select buttons */}
      <div className="flex gap-1 flex-wrap">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
          <button
            key={num}
            onClick={() => {
              setLocalValue(num);
              onChange(num);
            }}
            className={`w-8 h-8 text-sm font-medium rounded-md transition-colors ${
              Math.floor(localValue) === num
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-secondary/80 text-foreground'
            }`}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );
}
