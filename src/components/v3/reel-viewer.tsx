'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { FollowButton } from '@/components/follow-button';
import { haptic } from '@/lib/haptics';
import type { PostMedia } from '@/lib/types';

/**
 * F22 — "the reel" player. A full-screen, story-style viewer for one author's
 * uploaded photos / clips (a post's media). Header → segment chip → media →
 * author + follow → serif caption → tappable film tag → segment progress bars.
 * Tap the right/left third (or swipe) to move through the media; the film tag
 * hands off to the movie drawer.
 */
type ReelAuthor = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
};
type ReelFilm = { title: string; year: string; mediaType: 'movie' | 'tv'; posterUrl: string | null };

export function ReelViewer({
  isOpen,
  onClose,
  media,
  initialIndex = 0,
  author,
  caption,
  film,
  currentUserId,
  onOpenFilm,
}: {
  isOpen: boolean;
  onClose: () => void;
  media: PostMedia[];
  initialIndex?: number;
  author: ReelAuthor;
  caption?: string | null;
  film?: ReelFilm | null;
  currentUserId?: string | null;
  onOpenFilm?: () => void;
}) {
  const n = media.length;
  const [idx, setIdx] = useState(initialIndex);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) setIdx(Math.min(Math.max(0, initialIndex), Math.max(0, n - 1)));
  }, [isOpen, initialIndex, n]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen || n === 0) return null;
  const cur = media[Math.min(idx, n - 1)];

  const go = (d: 1 | -1) => {
    setIdx((i) => {
      const next = i + d;
      if (next < 0 || next >= n) return i;
      haptic('selection');
      return next;
    });
  };

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (dx > 44) go(-1);
    else if (dx < -44) go(1);
  };

  const isOwn = !!currentUserId && currentUserId === author.uid;
  const handle = author.username ? `@${author.username}` : author.displayName || 'someone';
  const filmMeta = film ? [film.year || null, film.mediaType === 'tv' ? 'tv' : 'film'].filter(Boolean).join(' · ') : '';

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background" role="dialog" aria-label="the reel">
      {/* header */}
      <div
        className="flex-shrink-0 flex items-center px-3 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <button onClick={() => { haptic('light'); onClose(); }} aria-label="Close" className="h-10 w-10 -ml-1 rounded-full flex items-center justify-center text-foreground active:bg-foreground/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </button>
        <span className="flex-1 text-center font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">the reel</span>
        <div className="h-10 w-10 -mr-1" aria-hidden />
      </div>

      {/* media + segment chip + tap zones */}
      <div
        className="relative flex-1 min-h-0 bg-black"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <span className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm font-mono text-[10px] font-bold text-white tabular-nums lowercase">
          {cur.type === 'video' && <Play className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} />}
          {cur.type === 'video' ? 'clip' : 'photo'} {idx + 1} / {n}
        </span>

        <div className="absolute inset-0 flex items-center justify-center">
          {cur.type === 'video' ? (
            <video
              key={cur.url}
              src={cur.url}
              poster={cur.thumbnailUrl}
              controls
              playsInline
              className="max-h-full max-w-full"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cur.url} alt="" className="max-h-full max-w-full object-contain" />
          )}
        </div>

        {/* tap zones — left third = prev, right third = next (skip for video so
            controls stay tappable; swipe still works on video). */}
        {cur.type !== 'video' && (
          <>
            {idx > 0 && <button aria-label="Previous" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3" />}
            {idx < n - 1 && <button aria-label="Next" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/3" />}
          </>
        )}
      </div>

      {/* footer */}
      <div className="flex-shrink-0 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
        <div className="flex items-center gap-2.5">
          <ProfileAvatar photoURL={author.photoURL} displayName={author.displayName} username={author.username} size="sm" />
          <span className="flex-1 min-w-0 font-mono font-bold text-[13px] text-foreground truncate">{handle}</span>
          {!isOwn && author.username && (
            <FollowButton targetUserId={author.uid} targetUsername={author.username} size="sm" />
          )}
        </div>

        {caption && (
          <p className="mt-2.5 font-serif italic text-[15px] leading-relaxed text-foreground">{caption}</p>
        )}

        {film && (
          <button
            onClick={() => { haptic('light'); onOpenFilm?.(); }}
            className="mt-3 w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] bg-card border border-hair text-left active:opacity-70"
          >
            <span className="relative w-9 h-[54px] rounded-[7px] overflow-hidden bg-sunken flex-shrink-0">
              {film.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={film.posterUrl} alt="" className="w-full h-full object-cover" />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-headline font-bold text-[15.5px] lowercase tracking-[-0.025em] truncate">{film.title}</span>
              {filmMeta && <span className="block font-mono text-[10px] text-muted-foreground mt-0.5">{filmMeta}</span>}
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2} />
          </button>
        )}

        {/* segment progress bars */}
        {n > 1 && (
          <div className="mt-3 flex gap-1.5">
            {media.map((_, k) => (
              <button
                key={k}
                onClick={() => { haptic('selection'); setIdx(k); }}
                aria-label={`Go to ${k + 1}`}
                className="flex-1 h-[3px] rounded-full overflow-hidden bg-foreground/15"
              >
                <span className={`block h-full rounded-full ${k <= idx ? 'bg-foreground' : ''}`} style={{ width: k <= idx ? '100%' : '0%' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
