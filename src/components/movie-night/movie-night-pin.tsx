'use client';

import { useEffect, useRef, useState } from 'react';
import { Pin, Sparkles } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { hasSeenMovieNightCoach, markMovieNightCoachSeen } from '@/lib/movie-night-format';
import { MovieNightCard } from './movie-night-card';
import { PlanMovieNightRow } from './plan-night-row';
import { useMovieNight, type MovieNightListContext } from './movie-night-provider';
import type { MovieNightPinView, MovieNightView } from '@/lib/movie-night-types';

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
 * MN14/MN29 — the SINGLE data source for "does this list have a movie
 * night." One fetch (`GET /lists/[ownerId]/[listId]/movie-night`, a
 * `publicApiRoute` — a public list's pinned night is visible to anyone, but
 * this component only fetches once a viewer is signed in, keeping an anon
 * page read-free), one decision: a night → the pinned card (MN14); no night
 * + the viewer can plan one (owner/collaborator) → the MN29 "no movie night
 * yet · plan one" one-liner; no night + can't plan → nothing.
 *
 * These two states used to be TWO SEPARATE components (`PlanMovieNightRow` +
 * this one) each running their OWN `useCachedAction` against the identical
 * cache key, rendered at two different spots on the page (the plan row
 * inside `ListHeader`, gated on the list doc having loaded; this one gated
 * only on an owner id, so it could mount FIRST). On a cold cache — or just
 * that mount-order gap — both could paint from `data:null` before either had
 * an answer: the plan row said "no movie night yet" while the pin (still
 * loading) said nothing, and once the fetch landed the two could still
 * momentarily disagree. One component, one hook call, one render decision:
 * that whole class of bug is now structurally impossible, and the previous
 * ownerId-only gate (which could fire the fetch against the WRONG owner id
 * for a collaborative list still mid-lookup) is gone too, since the caller
 * now waits for the real list context before mounting this at all.
 */
export function MovieNightPin({
  list,
  viewerUid,
  canPlan,
  className,
}: {
  list: MovieNightListContext;
  /** Pass `user?.uid` from the caller — gates the fetch to signed-in viewers. */
  viewerUid: string | null | undefined;
  /** Owner/collaborator — may see (and tap into) the MN29 "plan one" row
   *  when there's no night yet. Anyone else sees nothing until one exists. */
  canPlan: boolean;
  className?: string;
}) {
  const { openNight, openCreate, refreshToken } = useMovieNight();
  const key = viewerUid ? `list-night:${list.ownerId}:${list.id}` : null;
  const { data: night, refetch } = useCachedAction<MovieNightView | MovieNightPinView | null>(
    key,
    () => apiCall<MovieNightView | MovieNightPinView | null>('GET', `/api/v1/lists/${list.ownerId}/${list.id}/movie-night`),
    { staleTime: 60_000 },
  );

  // A RSVP/reschedule/cancel/create elsewhere (e.g. the detail sheet opened
  // FROM this very card) bumps `refreshToken` — the cache key stays stable
  // (so we don't leak an entry per bump), we just re-fire the fetch. In the
  // common case the mutating sheet ALREADY patched this exact cache entry
  // synchronously (`reportNightChange`, see `movie-night-provider.tsx`), so
  // this refetch is a confirmation, not the thing that makes the UI correct.
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current === refreshToken) return;
    lastToken.current = refreshToken;
    refetch();
  }, [refreshToken, refetch]);

  // MN30 — offer the coach mark once a pinned night is actually ON SCREEN
  // for a non-host viewer (the host already knows what they planned). The
  // redacted pin shape has no `viewer` field at all — treat that caller as
  // "not the host" (they're never the host of a night they're not on).
  const [showCoach, setShowCoach] = useState(false);
  useEffect(() => {
    if (!night) return;
    const isHost = 'viewer' in night && night.viewer.isHost;
    if (isHost) return;
    if (hasSeenMovieNightCoach()) return;
    setShowCoach(true);
  }, [night]);

  if (!night) {
    if (!canPlan) return null;
    return (
      <div className={className}>
        <PlanMovieNightRow onTap={() => openCreate({ list })} />
      </div>
    );
  }

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
