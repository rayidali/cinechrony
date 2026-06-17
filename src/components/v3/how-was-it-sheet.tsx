'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ChevronLeft } from 'lucide-react';
import { DragToRate, ClearRatingButton } from '@/components/v3/drag-to-rate';
import { haptic } from '@/lib/haptics';

const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

/**
 * F03 — "how was it?" The rate-review prompt shown when a film flips to watched.
 *
 * Rendered through a PORTAL to `document.body` (z-[95]) — this is essential: it's
 * mounted from inside the movie drawer, which the list page mounts inside
 * `PullToRefresh`, whose `translateY` container is a transformed ancestor that
 * (a) becomes the containing block for `position: fixed` and (b) creates a
 * stacking context — so an inline `fixed inset-0` got trapped BELOW the list's
 * viewport-fixed chrome (Hero, bottom-nav, FAB), which bled through. Portaling to
 * the body root escapes both traps and covers everything. (See
 * `project_drawer_route_roundtrip` — same class of bug as the Vaul seam.)
 *
 * A robust full-screen, opaque, `visualViewport`-pinned page (no Vaul → no
 * keyboard focus-trap jank). Three exits: save (watch+rating+review+watched),
 * skip (watch+watched, no rating), cancel (abandon — stays "to watch").
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
  onSave: (rating: number | null, note: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number | null>(initialRating && initialRating > 0 ? initialRating : 7.5);
  const [note, setNote] = useState('');
  const [kbInset, setKbInset] = useState(0);
  const [mounted, setMounted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) {
      setRating(initialRating && initialRating > 0 ? initialRating : 7.5);
      setNote('');
      setKbInset(0);
    }
  }, [isOpen, initialRating]);

  // Lock body scroll + track the keyboard inset (visualViewport) so the review
  // textarea always clears the keyboard.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const vv = window.visualViewport;
    const onResize = () => { if (vv) setKbInset(Math.max(0, window.innerHeight - vv.height)); };
    onResize();
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      document.body.style.overflow = '';
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-background" role="dialog" aria-label="how was it?">
      {/* header — cancel · title · save */}
      <header
        className="flex flex-shrink-0 items-center justify-between border-b border-hair px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}
      >
        <button
          onClick={() => { haptic('light'); onCancel(); }}
          aria-label="Cancel"
          className="flex h-9 w-9 -ml-1.5 items-center justify-center rounded-full text-primary transition-transform active:scale-90"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="font-headline text-[18px] font-bold lowercase tracking-[-0.02em]">how was it?</span>
        <button
          onClick={() => { haptic('success'); onSave(rating, note); }}
          className="font-ui text-[16px] font-bold text-primary transition-transform active:scale-95"
        >
          save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: Math.max(24, kbInset + 24) }}>
        {/* film cell */}
        <div className="flex items-center gap-3.5">
          <div className="relative h-[68px] w-[46px] flex-shrink-0 overflow-hidden rounded-[10px] bg-sunken shadow-photo">
            <Image src={posterUrl || POSTER_FALLBACK} alt="" fill className="object-cover" sizes="46px" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-headline text-[20px] font-bold lowercase tracking-tight">{movieTitle}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground lowercase">
              moving to watched{listName ? ` · in ${listName.toLowerCase()}` : ''}
            </div>
          </div>
        </div>

        {/* your rating */}
        <div className="mt-5 mb-2 flex items-center justify-between">
          <div className="cc-eyebrow text-muted-foreground">your rating</div>
          {rating != null && <ClearRatingButton onClear={() => setRating(null)} />}
        </div>
        <div className="rounded-2xl border border-hair bg-card p-4 shadow-press">
          <DragToRate value={rating} onChangeComplete={setRating} framed={false} />
        </div>

        {/* optional review — system-sans, matching the review composer */}
        <div className="mt-5">
          <div className="cc-eyebrow text-muted-foreground mb-2">add a review · optional</div>
          <div className="rounded-2xl border border-hair bg-card p-4 shadow-press">
            <textarea
              ref={textRef}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`;
              }}
              maxLength={500}
              rows={4}
              placeholder="say a little about it…"
              className="w-full resize-none bg-transparent font-ui text-[16.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/55 caret-primary"
            />
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[10.5px] leading-relaxed text-muted-foreground lowercase">
          this becomes your review on <span className="font-bold text-foreground">{movieTitle}</span> and moves it to watched
        </p>

        {/* skip — mark watched without a rating */}
        <button
          onClick={() => { haptic('light'); onSkip(); }}
          className="mt-5 w-full rounded-full border border-border bg-card py-3 font-ui text-[15px] font-semibold text-muted-foreground transition-transform active:scale-[0.98]"
        >
          just mark it watched
        </button>
      </div>
    </div>,
    document.body,
  );
}
