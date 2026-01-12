'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type NoteEditorOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
  initialNote: string;
  movieTitle: string;
  maxLength?: number;
};

export function NoteEditorOverlay({
  isOpen,
  onClose,
  onSave,
  initialNote,
  movieTitle,
  maxLength = 500,
}: NoteEditorOverlayProps) {
  const [note, setNote] = useState(initialNote);
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle mounting for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset note when opened with new initial value
  useEffect(() => {
    if (isOpen) {
      setNote(initialNote);
      // Focus textarea after a small delay to ensure it's rendered
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen, initialNote]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(note);
      onClose();
    } catch (error) {
      console.error('Failed to save note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = note !== initialNote;

  if (!mounted || !isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      style={{
        // Use dvh for proper mobile viewport handling
        height: '100dvh',
      }}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-background safe-area-top">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isSaving}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
        <h2 className="font-headline text-lg font-semibold truncate max-w-[50%]">
          Note
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="text-primary font-semibold"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Done'}
        </Button>
      </div>

      {/* Movie title context */}
      <div className="flex-shrink-0 px-4 py-2 bg-secondary/30 border-b border-border">
        <p className="text-sm text-muted-foreground truncate">
          For: <span className="font-medium text-foreground">{movieTitle}</span>
        </p>
      </div>

      {/* Textarea container - grows to fill space */}
      <div className="flex-1 flex flex-col min-h-0 p-4">
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a personal note about this movie..."
          maxLength={maxLength}
          className="flex-1 w-full resize-none text-base bg-transparent outline-none placeholder:text-muted-foreground leading-relaxed"
          style={{
            // Ensure 16px font to prevent iOS zoom
            fontSize: '16px',
          }}
        />

        {/* Character count */}
        <div className="flex-shrink-0 pt-2 text-right">
          <span className="text-xs text-muted-foreground">
            {note.length}/{maxLength}
          </span>
        </div>
      </div>

      {/* Safe area padding for bottom */}
      <div
        className="flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      />
    </div>
  );

  return createPortal(content, document.body);
}
