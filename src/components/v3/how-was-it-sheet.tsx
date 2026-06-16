'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { DragToRate } from '@/components/v3/drag-to-rate';
import { haptic } from '@/lib/haptics';
import { useViewportHeight } from '@/hooks/use-viewport-height';

const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

/**
 * F03 — "how was it?" (Phase 0.7 Wave 2 / slice 3). The rate-review prompt when
 * a film flips to watched in the in-list drawer: a drag-to-rate + an optional
 * note that becomes the film's review. `save` writes the watch + rating + review
 * and moves it to watched; `skip` just logs the watch (no rating) + moves it;
 * swipe-down / scrim cancels (the film stays "to watch").
 *
 * A Vaul bottom drawer (consistent with the app, portaled so it can't bleed
 * through a transformed ancestor, swipe-to-dismiss for cancel). The parent
 * movie drawer is closed while this is open, so there's no nested-Vaul trap.
 * Tall (≈90vh) so the note textarea sits above the keyboard.
 */
export function HowWasItSheet({
  isOpen,
  movieTitle,
  posterUrl,
  listName,
  initialRating,
  onSave,
  onSkip,
  onCancel,
}: {
  isOpen: boolean;
  movieTitle: string;
  posterUrl: string;
  listName?: string;
  initialRating: number | null;
  onSave: (rating: number, note: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number>(initialRating && initialRating > 0 ? initialRating : 7.5);
  const [note, setNote] = useState('');
  const height = useViewportHeight(90);

  // Fresh prompt each open.
  useEffect(() => {
    if (isOpen) {
      setRating(initialRating && initialRating > 0 ? initialRating : 7.5);
      setNote('');
    }
  }, [isOpen, initialRating]);

  const heightStyle = height > 0 ? `${height}px` : 'calc(90 * var(--dvh, 1vh))';

  return (
    <Drawer.Root open={isOpen} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[88]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[88] flex flex-col rounded-t-[22px] bg-card outline-none overflow-hidden"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Title className="sr-only">how was it?</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          {/* header */}
          <div className="flex items-center justify-between px-5 py-2.5">
            <button onClick={() => { haptic('light'); onSkip(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              skip
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">how was it?</span>
            <button onClick={() => { haptic('success'); onSave(rating, note); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              save
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            {/* film cell */}
            <div className="flex items-center gap-3 mt-1">
              <div className="relative h-14 w-10 flex-shrink-0 rounded-lg overflow-hidden bg-sunken">
                <Image src={posterUrl || POSTER_FALLBACK} alt="" fill className="object-cover" sizes="40px" />
              </div>
              <div className="min-w-0">
                <div className="font-headline font-bold text-[16px] lowercase tracking-[-0.02em] truncate">{movieTitle}</div>
                <div className="font-mono text-[10px] text-muted-foreground lowercase truncate">
                  moving to watched{listName ? ` · in ${listName.toLowerCase()}` : ''}
                </div>
              </div>
            </div>

            {/* drag to rate */}
            <div className="mt-4 rounded-2xl border border-hair bg-card p-4 shadow-press">
              <DragToRate value={rating} onChangeComplete={setRating} framed={false} />
            </div>

            {/* optional review */}
            <div className="mt-4">
              <div className="cc-eyebrow text-muted-foreground mb-2">add a review · optional</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="say a little about it…"
                className="w-full resize-none rounded-2xl border border-hair bg-background/60 px-4 py-3 font-serif italic text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/30 transition-colors"
              />
            </div>

            <p className="mt-4 text-center font-mono text-[10px] text-muted-foreground lowercase leading-relaxed">
              this becomes your review on <span className="font-bold">{movieTitle}</span> and moves it to watched
            </p>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
