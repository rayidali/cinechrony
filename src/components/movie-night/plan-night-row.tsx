'use client';

import { CalendarPlus } from 'lucide-react';
import { haptic } from '@/lib/haptics';

/**
 * MN29 — the quiet one-line invitation on a shared list that's never had a
 * movie night ("no movie night yet. · plan one →"), lowercase, muted, NOT a
 * banner (MOVIE-NIGHT-PLAN.md § S4).
 *
 * Pure presentational — NO data fetching. This used to run its OWN
 * `useCachedAction` on the exact same key `MovieNightPin` fetches
 * (`list-night:{owner}:{list}`), rendered at a DIFFERENT spot on the page;
 * on a cold cache (or the two components mounting in different render
 * passes) both could paint from `data:null` before either had an answer —
 * one showing this row, the other showing nothing — and briefly disagree
 * again once the fetch landed. `MovieNightPin` is now the ONE data source:
 * it fetches once and decides whether to render this row or the pinned
 * card, so the two can never show at once.
 */
export function PlanMovieNightRow({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { haptic('light'); onTap(); }}
      className="flex min-h-11 w-full items-center gap-2.5 text-left active:opacity-70"
    >
      <CalendarPlus className="h-[15px] w-[15px] flex-shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="font-ui text-[14px] font-medium text-muted-foreground">no movie night yet.</span>
      <span className="font-ui text-[14px] font-bold text-primary">plan one →</span>
    </button>
  );
}
