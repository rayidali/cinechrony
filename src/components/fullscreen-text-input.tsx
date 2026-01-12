'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { RatingSlider } from './rating-slider';

type FullscreenTextInputProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: string, rating?: number) => Promise<void>;
  initialValue: string;
  title: string;
  subtitle?: string;
  placeholder?: string;
  maxLength?: number;
  // Single-line mode (for short inputs like list names, URLs)
  singleLine?: boolean;
  // Input type for single-line mode
  inputType?: 'text' | 'url' | 'search';
  // Optional rating slider (for rate-on-watch flow)
  showRating?: boolean;
  initialRating?: number;
  ratingLabel?: string;
};

/**
 * A fullscreen text input overlay that works reliably on iOS Safari.
 *
 * This follows the same pattern as the search input in add-movie-modal:
 * - Simple `fixed inset-0` positioning
 * - No transforms, no Vaul, no portals
 * - Renders outside any transformed container
 *
 * CRITICAL: This component must be rendered when the parent Vaul drawer
 * is CLOSED, not alongside it. The drawer's focus trap will block input.
 *
 * This avoids all the iOS Safari keyboard issues that occur when
 * inputs are inside Vaul drawers (which use CSS transforms).
 */
export function FullscreenTextInput({
  isOpen,
  onClose,
  onSave,
  initialValue,
  title,
  subtitle,
  placeholder = 'Enter text...',
  maxLength = 500,
  singleLine = false,
  inputType = 'text',
  showRating = false,
  initialRating = 7,
  ratingLabel = 'Rating',
}: FullscreenTextInputProps) {
  const [text, setText] = useState(initialValue);
  const [rating, setRating] = useState(initialRating);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Reset state when opened with new initial values
  useEffect(() => {
    if (isOpen) {
      setText(initialValue);
      setRating(initialRating);
    }
  }, [isOpen, initialValue, initialRating]);

  // Auto-focus when opened (use autoFocus attribute, no setTimeout)
  // The autoFocus attribute is set directly on the input/textarea

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(text, showRating ? rating : undefined);
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      // Don't close on error - let parent handle via toast
    } finally {
      setIsSaving(false);
    }
  };

  // For multiline: check if content changed
  // For single-line with optional rating: different logic
  const hasChanges = showRating
    ? text !== initialValue || rating !== initialRating
    : text !== initialValue;

  // Allow save even without changes if it's a new entry (empty initial)
  const canSave = singleLine
    ? text.trim().length > 0
    : hasChanges || (initialValue === '' && text.trim().length > 0);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0 bg-background">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="flex items-center gap-1 px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 -ml-2"
        >
          <X className="h-5 w-5" />
          <span className="text-sm">Cancel</span>
        </button>
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={handleSave}
          disabled={isSaving || !canSave}
          className="px-3 py-1.5 text-primary font-semibold hover:text-primary/80 transition-colors disabled:opacity-50 min-w-[60px] text-right"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-auto" /> : 'Done'}
        </button>
      </div>

      {/* Subtitle / Context */}
      {subtitle && (
        <div className="px-4 py-2 bg-secondary/30 border-b border-border flex-shrink-0">
          <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
        </div>
      )}

      {/* Rating slider if enabled */}
      {showRating && (
        <div className="px-4 py-4 border-b border-border flex-shrink-0 bg-secondary/20">
          <RatingSlider
            value={rating}
            onChangeComplete={setRating}
            showClearButton={false}
            size="md"
            label={ratingLabel}
          />
        </div>
      )}

      {/* Input area - flex-1 to fill remaining space */}
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {singleLine ? (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={inputType}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize={inputType === 'url' ? 'none' : 'sentences'}
            spellCheck={inputType !== 'url'}
            className="w-full text-lg bg-transparent outline-none placeholder:text-muted-foreground border-b-2 border-border focus:border-primary pb-2 transition-colors"
            style={{ fontSize: '16px' }} // Prevents iOS zoom
          />
        ) : (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
            className="flex-1 w-full resize-none text-base bg-transparent outline-none placeholder:text-muted-foreground leading-relaxed"
            style={{ fontSize: '16px' }} // Prevents iOS zoom
          />
        )}

        {/* Character count (only for textarea or if maxLength is small) */}
        {(!singleLine || maxLength < 200) && (
          <div className="flex-shrink-0 pt-2 text-right">
            <span className="text-xs text-muted-foreground">
              {text.length}/{maxLength}
            </span>
          </div>
        )}
      </div>

      {/* Safe area for bottom */}
      <div
        className="flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      />
    </div>
  );
}
