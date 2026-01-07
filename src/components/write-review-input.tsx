'use client';

import { useState } from 'react';
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

  const isEditing = !!existingReview;
  const canSubmit = text.trim().length > 0 && text.trim().length <= 500;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (isEditing) {
        const result = await updateReview(currentUserId, existingReview.id, text);
        if (result.success) {
          toast({ title: 'Updated', description: 'Your review has been updated.' });
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
          toast({ title: 'Posted', description: 'Your review has been posted.' });
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

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did you think?"
          rows={3}
          maxLength={500}
          className="w-full resize-none rounded-xl border-2 border-border bg-background p-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {text.length}/500
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {isEditing && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="rounded-full"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="h-4 w-4 mr-1" />
              {isEditing ? 'Update' : 'Post'}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
