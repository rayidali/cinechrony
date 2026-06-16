'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { DragToRate } from '@/components/v3/drag-to-rate';
import { haptic } from '@/lib/haptics';

const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

/**
 * F03 — "how was it?" (Phase 0.7 Wave 2 / slice 3). The rate-review prompt when
 * a film flips to watched in the in-list drawer: a drag-to-rate + an optional
 * note that becomes the film's review. `save` writes the watch + rating + review
 * and moves it to watched; `skip` just logs the watch (no rating) + moves it;
 * tapping the scrim cancels (the film stays "to watch").
 *
 * Intentionally NOT a Vaul drawer: the note textarea would fight the parent
 * drawer's focus trap on iOS. This is a plain fixed overlay (top-anchored so the
 * keyboard never covers it), shown while the parent drawer is closed.
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
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal needs `document` — only available after mount (static export SSRs).
  useEffect(() => { setMounted(true); }, []);

  // Reset to a fresh prompt each open; trigger the enter transition.
  useEffect(() => {
    if (isOpen) {
      setRating(initialRating && initialRating > 0 ? initialRating : 7.5);
      setNote('');
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [isOpen, initialRating]);

  if (!isOpen || !mounted) return null;

  // Portal to <body> so the sheet is viewport-fixed and z-index escapes any
  // transformed ancestor (e.g. the list page's PullToRefresh) — otherwise the
  // page behind bleeds through and the overlay is mispositioned. [[project_drawer_route_roundtrip]]
  return createPortal(
    <div className="fixed inset-0 z-[88]">
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onCancel}
      />
      <div
        className={`absolute top-0 left-0 right-0 bg-card rounded-b-[26px] shadow-[0_18px_50px_rgba(0,0,0,0.4)] transition-all duration-200 ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="px-5 pb-6">
          {/* header */}
          <div className="flex items-center justify-between py-2">
            <button onClick={() => { haptic('light'); onSkip(); }} className="font-ui font-semibold text-[15px] text-muted-foreground active:opacity-60">
              skip
            </button>
            <span className="font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">how was it?</span>
            <button onClick={() => { haptic('success'); onSave(rating, note); }} className="font-ui font-bold text-[15px] text-primary active:opacity-60">
              save
            </button>
          </div>

          {/* film cell */}
          <div className="flex items-center gap-3 mt-2">
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
              rows={3}
              placeholder="say a little about it…"
              className="w-full resize-none rounded-2xl border border-hair bg-background/60 px-4 py-3 font-serif italic text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/30 transition-colors"
            />
          </div>

          <p className="mt-4 text-center font-mono text-[10px] text-muted-foreground lowercase leading-relaxed">
            this becomes your review on <span className="font-bold">{movieTitle}</span> and moves it to watched
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
