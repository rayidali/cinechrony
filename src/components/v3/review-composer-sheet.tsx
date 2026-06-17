'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, EyeOff } from 'lucide-react';
import { DragToRate } from '@/components/v3/drag-to-rate';
import { seededGradient } from '@/lib/seeded-gradient';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

export type ComposerFilm = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | null;
  director?: string | null;
  posterUrl?: string | null;
};

/**
 * ReviewComposerSheet (F13) — the rating-forward "write a review" composer. A
 * fixed, `visualViewport`-pinned bottom sheet (NOT a Vaul drawer — a textarea
 * inside Vaul fights the iOS focus-trap; this mirrors the proven post-composer
 * surface): film header → drag-to-rate → body → mark-spoilers → post.
 *
 * A rating is OPTIONAL — rated → a scored review, unrated → a "note". Text is
 * required. ("add a still" is a tracked fast-follow.) On post it sets the
 * canonical rating (if any) + creates the review, then asks the wall to reload.
 *
 * z-[80] (above the wall + bottom bar). Capacitor-safe: pure client.
 */
export function ReviewComposerSheet({
  isOpen,
  onClose,
  film,
  initialRating = null,
  startMode = 'write',
  onPosted,
}: {
  isOpen: boolean;
  onClose: () => void;
  film: ComposerFilm;
  initialRating?: number | null;
  startMode?: 'rate' | 'write';
  onPosted: () => void;
}) {
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(initialRating);
  const [text, setText] = useState('');
  const [hasSpoiler, setHasSpoiler] = useState(false);
  const [posting, setPosting] = useState(false);
  const [kbInset, setKbInset] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed each open.
  useEffect(() => {
    if (isOpen) {
      setRating(initialRating);
      setText('');
      setHasSpoiler(false);
      setPosting(false);
      // Focus the body when entering in "write" mode (a small delay lets the
      // sheet mount before the keyboard rises).
      if (startMode === 'write') {
        const t = setTimeout(() => textRef.current?.focus(), 250);
        return () => clearTimeout(t);
      }
    }
  }, [isOpen, initialRating, startMode]);

  // Keyboard inset (visualViewport) so the sheet content clears the keyboard.
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKbInset(Math.max(0, window.innerHeight - vv.height));
    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const canPost = text.trim().length > 0 && !posting;
  const meta = [film.year, film.director].filter(Boolean).join(' · ');

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      if (rating != null) {
        await apiCall('POST', '/api/v1/ratings', {
          tmdbId: film.tmdbId,
          mediaType: film.mediaType,
          movieTitle: film.title,
          moviePosterUrl: film.posterUrl || undefined,
          rating,
        });
      }
      await apiCall('POST', '/api/v1/reviews', {
        tmdbId: film.tmdbId,
        mediaType: film.mediaType,
        movieTitle: film.title,
        moviePosterUrl: film.posterUrl || undefined,
        text: text.trim(),
        ratingAtTime: rating ?? null,
        hasSpoiler,
      });
      haptic('success');
      onPosted();
      onClose();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Couldn’t post',
        description: err instanceof ApiClientError ? err.message : 'Please try again.',
      });
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-label="Write a review">
      {/* scrim — the wall peeks above the sheet */}
      <button aria-label="Cancel" className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[22px] bg-background shadow-[0_-10px_40px_rgba(0,0,0,0.25)]"
        style={{ top: 'calc(env(safe-area-inset-top) + 52px)' }}
      >
        {/* grabber */}
        <div className="mx-auto mt-2.5 h-1 w-10 flex-shrink-0 rounded-full bg-foreground/15" />

        {/* header */}
        <div className="flex flex-shrink-0 items-center justify-between px-5 pb-3 pt-2.5">
          <button onClick={onClose} className="font-ui text-[16px] text-muted-foreground active:opacity-60">
            cancel
          </button>
          <h2 className="font-headline text-[18px] font-bold lowercase tracking-tight">write a review</h2>
          <button
            onClick={handlePost}
            disabled={!canPost}
            className="inline-flex items-center gap-1.5 font-ui text-[16px] font-bold text-primary transition-opacity active:scale-95 disabled:opacity-40"
          >
            {posting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            post
          </button>
        </div>

        {/* content */}
        <div className="flex-1 overflow-y-auto px-5 pt-2" style={{ paddingBottom: Math.max(24, kbInset + 24) }}>
          {/* film header */}
          <div className="flex items-center gap-3.5">
            <div
              className="relative h-[68px] w-[46px] flex-shrink-0 overflow-hidden rounded-[10px] shadow-photo"
              style={film.posterUrl ? undefined : { background: seededGradient(film.title) }}
            >
              {film.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={film.posterUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate font-headline text-[22px] font-bold lowercase tracking-tight text-foreground">
                {film.title}
              </div>
              {meta && <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">{meta}</div>}
            </div>
          </div>

          {/* drag to rate */}
          <div className="mt-4">
            <DragToRate value={rating} onChangeComplete={(v) => setRating(v)} />
          </div>

          {/* body */}
          <div className="mt-3 rounded-2xl border border-hair bg-card p-4 shadow-press">
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`;
              }}
              maxLength={2000}
              rows={4}
              placeholder="what did you think?"
              className="w-full resize-none bg-transparent font-ui text-[16.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground/55 caret-primary"
            />
          </div>

          {/* mark spoilers (add-a-still is a fast-follow) */}
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => { haptic('light'); setHasSpoiler((v) => !v); }}
              className={cn(
                'inline-flex h-11 items-center gap-2 rounded-full border px-4 font-ui text-[14px] font-semibold transition-transform active:scale-[0.97]',
                hasSpoiler ? 'border-primary text-primary' : 'border-border bg-card text-foreground',
              )}
            >
              <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.8} />
              {hasSpoiler ? 'spoilers marked' : 'mark spoilers'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
