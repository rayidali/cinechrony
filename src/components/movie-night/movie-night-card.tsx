'use client';

import { ArrowRight, ChevronRight, Play } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { NightPoster } from './night-ui';
import {
  formatNightDate, formatNightDateShort, formatNightTime, formatNightWeekdayShort, nightPhase,
} from '@/lib/movie-night-format';
import type { MovieNightCardData } from '@/lib/movie-night-types';

/**
 * The compact movie-night object (MOVIE-NIGHT-PLAN.md § S3b) — the ONE card
 * reused everywhere the night shows up small: pinned to a list (MN14),
 * borderless in the home feed (MN15), and (S4) the day-of/final-hour list
 * variants. Mirrors the design's `MovieNightCard` exactly, on the app's real
 * tokens instead of the mock's raw oklch.
 *
 * Two independent, auto-derived facts drive the display (matching the
 * design's own component, which took them as separate props rather than one
 * enum): `completion` → the "done" mono line + eyebrow: `previousScheduledFor`
 * → the struck-through "moved" mono line (independent of the eyebrow — a
 * rescheduled night can ALSO be happening tonight). `variant` is an optional
 * override for the phase-driven eyebrow only (pinned/feed/today/soon/now) —
 * omit it and the card reads the room itself via `nightPhase`.
 *
 * F5 — `night` is typed `MovieNightCardData` (a Pick over the fields this
 * card actually reads), NOT the full `MovieNightView` — it's satisfied by
 * BOTH the full view (host/invitee) and the redacted `MovieNightPinView`
 * `getListMovieNight` returns to a stranger on a public list. `completion`/
 * `previousScheduledFor` are optional in that shape, so a stranger's thin
 * pin just always reads as the plain "N going" variant.
 */
export type MovieNightCardVariant = 'pinned' | 'feed' | 'today' | 'soon' | 'now' | 'done' | 'moved';

type EyebrowVariant = 'pinned' | 'feed' | 'today' | 'soon' | 'now' | 'done';

const EYEBROW_TEXT: Record<EyebrowVariant, string> = {
  now: 'happening now',
  soon: 'starting soon',
  today: 'tonight',
  done: 'watched together',
  pinned: 'movie night',
  feed: 'movie night',
};

function deriveEyebrowVariant(night: MovieNightCardData): EyebrowVariant {
  if (night.completion) return 'done';
  const phase = nightPhase(night.scheduledFor);
  if (phase === 'now') return 'now';
  if (phase === 'soon') return 'soon';
  if (phase === 'today') return 'today';
  return 'pinned';
}

export function MovieNightCard({
  night,
  variant,
  onTap,
  className = '',
}: {
  night: MovieNightCardData;
  /** Override the phase-driven eyebrow (pinned/feed/today/soon/now). Leave
   *  unset to let the card derive it from `nightPhase` — the usual case.
   *  Passing `'done'`/`'moved'` has no extra effect: those are always
   *  derived from `night.completion`/`night.previousScheduledFor`. */
  variant?: MovieNightCardVariant;
  onTap?: () => void;
  className?: string;
}) {
  const done = !!night.completion;
  const moved = !done && !!night.previousScheduledFor;
  const eyebrowVariant: EyebrowVariant = done
    ? 'done'
    : variant && variant !== 'moved' && variant !== 'done'
      ? variant
      : deriveEyebrowVariant(night);

  const live = eyebrowVariant === 'now';
  const soon = eyebrowVariant === 'soon';
  const going = night.counts.going;

  return (
    <button
      type="button"
      onClick={() => { haptic('light'); onTap?.(); }}
      className={`relative flex w-full min-h-[44px] items-center gap-3.5 rounded-[18px] border bg-card p-3.5 text-left shadow-lift transition-transform active:scale-[0.99] ${
        live ? 'border-[1.5px] border-primary' : 'border-hair'
      } ${className}`}
    >
      <div className="relative w-[52px] flex-shrink-0">
        <NightPoster film={night.film} rounded="rounded-[9px]" />
        {live && (
          <span
            className="absolute -left-1.5 -top-1.5 h-4 w-4 rounded-full border-2 border-card bg-primary"
            style={{ boxShadow: '0 0 0 3px oklch(var(--primary) / 0.27)' }}
            aria-hidden
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5">
          {live && <span className="h-[7px] w-[7px] flex-shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />}
          <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.14em] ${soon ? 'text-warning' : 'text-primary'}`}>
            {EYEBROW_TEXT[eyebrowVariant]}
          </span>
        </span>

        <div className="mt-1.5 truncate font-headline text-[18px] font-bold lowercase leading-[1.02] tracking-[-0.03em] text-foreground">
          {night.film.title}
        </div>

        {done ? (
          <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            {formatNightDateShort(night.scheduledFor, night.tzOffsetMinutes)} · {going} of you
          </div>
        ) : moved && night.previousScheduledFor ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] tabular-nums text-faint line-through">
              {formatNightDate(night.previousScheduledFor, night.tzOffsetMinutes)}
            </span>
            <ArrowRight className="h-[11px] w-[11px] text-muted-foreground" strokeWidth={2.2} />
            <span className="font-mono text-[10.5px] font-bold tabular-nums text-foreground">
              {formatNightDate(night.scheduledFor, night.tzOffsetMinutes)}
            </span>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold tabular-nums tracking-[-0.01em] text-foreground">
              {eyebrowVariant === 'today' || eyebrowVariant === 'now'
                ? formatNightTime(night.scheduledFor, night.tzOffsetMinutes)
                : `${formatNightWeekdayShort(night.scheduledFor, night.tzOffsetMinutes)} ${formatNightTime(night.scheduledFor, night.tzOffsetMinutes)}`}
            </span>
            <span className="h-[3px] w-[3px] flex-shrink-0 rounded-full bg-faint" aria-hidden />
            <span className="font-mono text-[11px] text-muted-foreground">{going} going</span>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-col items-end justify-center gap-2">
        {live ? (
          <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-primary px-3.5 font-headline text-[12.5px] font-bold lowercase text-primary-foreground">
            <Play className="h-[13px] w-[13px]" strokeWidth={2.6} fill="currentColor" />
            join
          </span>
        ) : (
          <ChevronRight className="h-[19px] w-[19px] text-faint" strokeWidth={2} />
        )}
      </div>
    </button>
  );
}
