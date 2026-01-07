'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RatingSlider } from './rating-slider';

interface RateOnWatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  movieTitle: string;
  onSave: (rating: number, comment: string) => Promise<void>;
  onSkip: () => void;
}

export function RateOnWatchModal({
  isOpen,
  onClose,
  movieTitle,
  onSave,
  onSkip,
}: RateOnWatchModalProps) {
  const [rating, setRating] = useState<number>(7);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(rating, comment);
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    onClose();
  };

  const handleRatingChange = (value: number) => {
    setRating(value);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleSkip()}>
      <DialogContent className="max-w-md border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
        <DialogHeader>
          <DialogTitle className="text-xl">How was it?</DialogTitle>
          <DialogDescription className="text-base">
            Rate <span className="font-semibold text-foreground">{movieTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Rating Slider */}
          <RatingSlider
            value={rating}
            onChangeComplete={handleRatingChange}
            showClearButton={false}
            size="md"
            label=""
          />

          {/* Comment Input */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Add a comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your thoughts..."
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-lg border-2 border-border bg-secondary/50 px-4 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleSkip}
              disabled={isSaving}
            >
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
