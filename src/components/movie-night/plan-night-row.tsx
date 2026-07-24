'use client';

import { useEffect, useRef } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useUser } from '@/firebase';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { haptic } from '@/lib/haptics';
import { useMovieNight, type MovieNightListContext } from './movie-night-provider';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * MN29 — the quiet one-line invitation on a shared list that's never had a
 * movie night ("no movie night yet. · plan one →"), lowercase, muted, NOT a
 * banner — replaces S3's bordered MN02 row now that the lifecycle has a
 * pinned-night state to hand off to (MOVIE-NIGHT-PLAN.md § S4).
 *
 * Renders NOTHING once a night exists for the list — `MovieNightPin`
 * (rendered elsewhere on the same page) takes over at that point, so the two
 * components never show at once. They read the EXACT same cache key
 * (`list-night:{owner}:{list}`, `movie-night-pin.tsx`), so mounting this row
 * alongside the pin doesn't cost a second Firestore read — `useCachedAction`
 * coalesces both callers onto one in-flight fetch.
 */
export function PlanMovieNightRow({ list }: { list: MovieNightListContext }) {
  const { openCreate, refreshToken } = useMovieNight();
  const { user } = useUser();
  const key = user?.uid ? `list-night:${list.ownerId}:${list.id}` : null;
  const { data: night, refetch } = useCachedAction<MovieNightView | null>(
    key,
    () => apiCall<MovieNightView | null>('GET', `/api/v1/lists/${list.ownerId}/${list.id}/movie-night`),
    { staleTime: 60_000 },
  );

  // Same "revalidate on a mutation elsewhere" contract as `MovieNightPin`.
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current === refreshToken) return;
    lastToken.current = refreshToken;
    refetch();
  }, [refreshToken, refetch]);

  if (night) return null; // a night exists — the pin owns the display now

  return (
    <button
      type="button"
      onClick={() => { haptic('light'); openCreate({ list }); }}
      className="flex min-h-11 w-full items-center gap-2.5 text-left active:opacity-70"
    >
      <CalendarPlus className="h-[15px] w-[15px] flex-shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="font-ui text-[14px] font-medium text-muted-foreground">no movie night yet.</span>
      <span className="font-ui text-[14px] font-bold text-primary">plan one →</span>
    </button>
  );
}
