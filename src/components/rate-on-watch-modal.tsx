'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 animate-in fade-in duration-200"
        onClick={handleSkip}
      />
      {/* Modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className="relative bg-background max-w-md w-full rounded-lg border-[3px] border-black shadow-[8px_8px_0px_0px_#000] p-6 animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={handleSkip}
            className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>

          {/* Header */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold">How was it?</h2>
            <p className="text-muted-foreground">
              Rate <span className="font-semibold text-foreground">{movieTitle}</span>
            </p>
          </div>

          <div className="space-y-4">
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
        </div>
      </div>
    </div>
  );
}
