'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';

type FullscreenTextInputProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
  initialValue: string;
  title: string;
  subtitle?: string;
  placeholder?: string;
  maxLength?: number;
};

/**
 * A fullscreen text input overlay that works reliably on iOS Safari.
 *
 * This follows the same pattern as the search input in add-movie-modal:
 * - Simple `fixed inset-0` positioning
 * - No transforms, no Vaul, no portals
 * - Renders outside any transformed container
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
}: FullscreenTextInputProps) {
  const [text, setText] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset text when opened with new initial value
  useEffect(() => {
    if (isOpen) {
      setText(initialValue);
      // Focus after render
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [isOpen, initialValue]);

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
      await onSave(text);
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      // Don't close on error - let parent handle via toast
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = text !== initialValue;

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="px-3 py-1.5 text-primary font-semibold hover:text-primary/80 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Done'}
        </button>
      </div>

      {/* Subtitle / Context */}
      {subtitle && (
        <div className="px-4 py-2 bg-secondary/30 border-b border-border flex-shrink-0">
          <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
        </div>
      )}

      {/* Textarea - flex-1 to fill remaining space */}
      <div className="flex-1 flex flex-col min-h-0 p-4">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="flex-1 w-full resize-none text-base bg-transparent outline-none placeholder:text-muted-foreground leading-relaxed"
          style={{ fontSize: '16px' }} // Prevents iOS zoom
        />

        {/* Character count */}
        <div className="flex-shrink-0 pt-2 text-right">
          <span className="text-xs text-muted-foreground">
            {text.length}/{maxLength}
          </span>
        </div>
      </div>

      {/* Safe area for bottom */}
      <div
        className="flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      />
    </div>
  );
}
