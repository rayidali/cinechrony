'use client';

import { CalendarPlus } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { useMovieNight, type MovieNightListContext } from './movie-night-provider';

/**
 * MN02 — the quieter outlined "plan a movie night" row on a shared-list
 * detail. Film-first: no film is known here, so `openCreate` is called with
 * only the list — the create sheet opens with the film slot empty and
 * prompts the picker itself (MOVIE-NIGHT-PLAN.md § S3).
 *
 * A standalone component (not inlined into `ListHeader`) on purpose: S4
 * replaces this row with the MN29 one-liner once a night already exists for
 * the list, and keeping the component boundary clean here means that swap
 * won't have to touch `ListHeader` itself.
 */
export function PlanMovieNightRow({ list }: { list: MovieNightListContext }) {
  const { openCreate } = useMovieNight();
  return (
    <button
      type="button"
      onClick={() => { haptic('light'); openCreate({ list }); }}
      className="flex w-full items-center gap-2.5 rounded-2xl border border-border px-4 py-3.5 text-left transition-colors active:bg-secondary"
    >
      <CalendarPlus className="h-[18px] w-[18px] flex-shrink-0 text-primary" strokeWidth={2} />
      <span className="flex-1 font-ui text-[14.5px] font-semibold text-foreground">plan a movie night</span>
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">pick a film →</span>
    </button>
  );
}
