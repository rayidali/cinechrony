'use client';

import { useEffect, useRef, useState } from 'react';
import { Pin, Sparkles } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { hasSeenMovieNightCoach, markMovieNightCoachSeen } from '@/lib/movie-night-format';
import { MovieNightCard } from './movie-night-card';
import { useMovieNight } from './movie-night-provider';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * MN30 — the first-run "NEW · MOVIE NIGHT" spotlight, shown the first time a
 * non-host viewer sees a pinned night. `absolute`, relative to the pin's own
 * wrapper (no portal — matches the design's "keep it dumb and safe" note).
 * Dismisses forever (either action) via the `cc-mn-coach` localStorage flag.
 */
function CoachMark({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-2">
      <div className="flex justify-center">
        <div className="h-0 w-0 border-x-[9px] border-b-[9px] border-x-transparent border-b-card" />
      </div>
      <div className="-mt-px rounded-[18px] border border-hair bg-card p-4 shadow-lift">
        <div className="inline-flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-primary">
          <Sparkles className="h-3 w-3" strokeWidth={2.2} />
          new · movie night
        </div>
        <p className="mt-2 font-serif text-[15px] italic leading-snug text-foreground">
          your shared lists can plan a night now. tap to see who&apos;s in and say if you&apos;ll be there.
        </p>
        <div className="mt-3 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={() => { haptic('light'); onDismiss(); }}
            className="font-ui text-[13.5px] font-semibold text-muted-foreground active:opacity-60"
          >
            skip
          </button>
          <button
            type="button"
            onClick={() => { haptic('light'); onDismiss(); }}
            className="h-9 rounded-full bg-primary px-4 font-headline text-[14px] font-bold lowercase tracking-[-0.02em] text-primary-foreground active:scale-95"
          >
            got it
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * MN14 — the movie night pinned above a list's to-watch/watched toolbar
 * (MOVIE-NIGHT-PLAN.md § S3b). `GET /lists/[ownerId]/[listId]/movie-night`
 * is a `publicApiRoute` (a public list's pinned night is visible to anyone),
 * but this component only fetches once a viewer is signed in — an anonymous
 * visitor never sees an "add a movie night" affordance anyway, and it keeps
 * an anon page read-free. Renders nothing when there's no pinned night —
 * this is a decoration, not a banner.
 */
export function MovieNightPin({
  ownerId,
  listId,
  viewerUid,
  className,
}: {
  ownerId: string;
  listId: string;
  /** Pass `user?.uid` from the caller — gates the fetch to signed-in viewers. */
  viewerUid: string | null | undefined;
  className?: string;
}) {
  const { openNight, refreshToken } = useMovieNight();
  const key = viewerUid ? `list-night:${ownerId}:${listId}` : null;
  const { data: night, refetch } = useCachedAction<MovieNightView | null>(
    key,
    () => apiCall<MovieNightView | null>('GET', `/api/v1/lists/${ownerId}/${listId}/movie-night`),
    { staleTime: 60_000 },
  );

  // A RSVP/reschedule/cancel/create elsewhere (e.g. the detail sheet opened
  // FROM this very card) bumps `refreshToken` — the cache key stays stable
  // (so we don't leak an entry per bump), we just re-fire the fetch.
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current === refreshToken) return;
    lastToken.current = refreshToken;
    refetch();
  }, [refreshToken, refetch]);

  // MN30 — offer the coach mark once a pinned night is actually ON SCREEN
  // for a non-host viewer (the host already knows what they planned).
  const [showCoach, setShowCoach] = useState(false);
  useEffect(() => {
    if (!night || night.viewer.isHost) return;
    if (hasSeenMovieNightCoach()) return;
    setShowCoach(true);
  }, [night]);

  if (!night) return null;

  return (
    <div className={cn('relative mb-5', className)}>
      <div className="mb-2.5 ml-0.5 flex items-center gap-1.5">
        <Pin className="h-3 w-3 text-primary" strokeWidth={2.2} />
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-primary">pinned · movie night</span>
      </div>
      <div className={cn(showCoach && 'relative rounded-[18px] ring-[3px] ring-primary')}>
        <MovieNightCard night={night} onTap={() => openNight(night.id)} />
      </div>
      {showCoach && (
        <CoachMark onDismiss={() => { markMovieNightCoachSeen(); setShowCoach(false); }} />
      )}
    </div>
  );
}
