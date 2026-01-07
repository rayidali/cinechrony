'use client';

import { useState, useRef } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { createReview, updateReview } from '@/app/actions';
import type { Review } from '@/lib/types';

interface WriteReviewInputProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  movieTitle: string;
  moviePosterUrl?: string;
  currentUserId: string;
  existingReview?: Review;
  onReviewCreated?: (review: Review) => void;
  onReviewUpdated?: (review: Review) => void;
  onCancel?: () => void;
}

export function WriteReviewInput({
  tmdbId,
  mediaType,
  movieTitle,
  moviePosterUrl,
  currentUserId,
  existingReview,
  onReviewCreated,
  onReviewUpdated,
  onCancel,
}: WriteReviewInputProps) {
  const { toast } = useToast();
  const [text, setText] = useState(existingReview?.text || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditing = !!existingReview;
  const canSubmit = text.trim().length > 0 && text.trim().length <= 500;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (isEditing) {
        const result = await updateReview(currentUserId, existingReview.id, text);
        if (result.success) {
          toast({ title: 'Updated', description: 'Your comment has been updated.' });
          onReviewUpdated?.({
            ...existingReview,
            text: text.trim(),
            updatedAt: new Date(),
          });
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
      } else {
        const result = await createReview(
          currentUserId,
          tmdbId,
          mediaType,
          movieTitle,
          moviePosterUrl,
          text
        );
        if (result.success && result.review) {
          toast({ title: 'Posted', description: 'Your comment has been posted.' });
          setText('');
          onReviewCreated?.(result.review as Review);
        } else {
          toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Something went wrong.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-end gap-2">
      {/* Text input area */}
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          rows={1}
          maxLength={500}
          className="w-full resize-none rounded-2xl border-2 border-border bg-secondary/50 px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background min-h-[42px] max-h-[120px]"
          style={{
            height: 'auto',
            overflow: 'hidden',
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = Math.min(target.scrollHeight, 120) + 'px';
          }}
        />
        {text.length > 400 && (
          <span className="absolute bottom-1 right-3 text-xs text-muted-foreground">
            {text.length}/500
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 pb-0.5">
        {isEditing && onCancel && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            disabled={isSubmitting}
            className="h-9 w-9 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="h-9 w-9 rounded-full"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
