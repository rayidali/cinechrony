'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCheck, History, Share } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { getRatingStyle } from '@/lib/utils';
import { verdictFlavor } from '@/lib/story-card';
import { ProfileAvatar } from '@/components/profile-avatar';
import {
  formatNightDate, formatNightDateShort, formatNightTime,
} from '@/lib/movie-night-format';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * The lifecycle's "after" blocks (MOVIE-NIGHT-PLAN.md § S4) — the parts of
 * the detail sheet that only apply to a night that has RESOLVED (completed /
 * didn't happen) or was rescheduled while still active. Kept out of
 * `night-detail-sheet.tsx` so that already-large file doesn't grow further;
 * each block is a pure presentational read of `MovieNightView`.
 */

// ── MN26 — "watched together" (completed) ──────────────────────────────

export function CompletedBlock({ night }: { night: MovieNightView }) {
  const count = night.completion?.attendeeUids.length ?? 0;
  return (
    <div className="my-5 border-y border-hair py-5 text-center">
      <div className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-success">
        <CheckCheck className="h-3.5 w-3.5" strokeWidth={2.4} />
        watched together
      </div>
      <div className="mt-2.5 font-headline text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums text-foreground">
        {formatNightDateShort(night.scheduledFor, night.tzOffsetMinutes)}
      </div>
      <p className="mt-2.5 font-mono text-[11.5px] text-muted-foreground">
        {count} of you {count === 1 ? 'was' : 'were'} there
      </p>
    </div>
  );
}

/** MN26 — "HOW YOU RATED IT": attendee avatars, each with a rating chip when
 *  discoverable. Ratings for OTHER attendees are read via the same cheap,
 *  public single-doc lookup the app already exposes
 *  (`GET /api/v1/ratings/by-user?userId=&tmdbId=`, deterministic doc id, no
 *  query) — bounded to `completion.attendeeUids` (≤10). A missing rating
 *  shows the avatar WITHOUT a chip rather than a fabricated number; the "the
 *  group landed on…" line only appears once ≥2 real ratings are visible. */
export function AttendeeRatingsRail({ night, viewerUid }: { night: MovieNightView; viewerUid: string | undefined }) {
  const attendeeUids = night.completion?.attendeeUids ?? [];
  const [ratings, setRatings] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    if (attendeeUids.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        attendeeUids.map(async (uid) => {
          try {
            const res = await apiCall<{ rating: { rating: number } | null }>(
              'GET', `/api/v1/ratings/by-user?userId=${uid}&tmdbId=${night.film.tmdbId}`,
            );
            return [uid, res.rating?.rating ?? null] as const;
          } catch {
            return [uid, null] as const;
          }
        }),
      );
      if (!cancelled) setRatings(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendeeUids.join('|'), night.film.tmdbId]);

  if (attendeeUids.length === 0) return null;

  const people = attendeeUids.map((uid) => {
    const inv = night.invitees.find((i) => i.uid === uid);
    return {
      uid,
      name: inv?.displayName || inv?.username || 'friend',
      photoURL: inv?.photoURL ?? null,
      username: inv?.username ?? null,
      rating: ratings[uid] ?? null,
    };
  });

  const visible = people.map((p) => p.rating).filter((r): r is number => typeof r === 'number');
  const avg = visible.length >= 2 ? visible.reduce((a, b) => a + b, 0) / visible.length : null;
  const flavor = avg != null ? verdictFlavor(avg) : null;

  return (
    <>
      <div className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 scrollbar-hide">
        {people.map((p) => {
          const chip = p.rating != null ? getRatingStyle(p.rating) : null;
          return (
            <div key={p.uid} className="w-[62px] flex-shrink-0 text-center">
              <ProfileAvatar photoURL={p.photoURL} displayName={p.name} username={p.username} size="md" />
              {chip && (
                <div
                  className="mx-auto mt-1.5 inline-flex h-5 min-w-[30px] items-center justify-center rounded-[6px] px-1.5 font-headline text-[11px] font-bold tabular-nums"
                  style={{ ...chip.background, ...chip.textOnBg }}
                >
                  {p.rating!.toFixed(1)}
                </div>
              )}
              <div className="mt-1 truncate font-ui text-[11px] font-semibold text-foreground">
                {p.uid === viewerUid ? 'you' : p.name.toLowerCase()}
              </div>
            </div>
          );
        })}
      </div>
      {avg != null && flavor && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="font-ui text-[13px] font-semibold text-muted-foreground">the group landed on</span>
          <span className="font-headline text-[14px] font-bold tabular-nums" style={{ color: getRatingStyle(avg).accent.color as string }}>
            {avg.toFixed(1)}
          </span>
          <span className="font-serif text-[14px] italic text-foreground">{flavor}</span>
        </div>
      )}
    </>
  );
}

/** MN26 footer — "share the night". Opens the OS share sheet with the
 *  `/n/[code]` guest link (S5) via `handleShareNight` in the parent detail
 *  sheet (shared with the MN10 header icon — one share text, one place it can
 *  drift). */
export function ShareNightRow({ onShare }: { onShare: () => void }) {
  return (
    <button
      type="button"
      onClick={onShare}
      className="flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl border border-hair bg-card text-center active:scale-[0.99]"
    >
      <Share className="h-[17px] w-[17px] text-muted-foreground" strokeWidth={2} />
      <span className="font-ui text-[15px] font-semibold text-foreground">share the night</span>
    </button>
  );
}

// ── MN27 — the didn't-happen record ─────────────────────────────────────

export function DidntHappenBlock({ night }: { night: MovieNightView }) {
  return (
    <div className="my-5 rounded-2xl border border-dashed border-rule bg-card px-4 py-4 text-center">
      <div className="font-headline text-[18px] font-bold lowercase tracking-[-0.03em] text-foreground">this one didn&apos;t happen</div>
      <p className="mx-auto mt-1.5 max-w-[260px] font-serif text-[14px] italic leading-snug text-muted-foreground">
        nobody made it on {formatNightDate(night.scheduledFor, night.tzOffsetMinutes)}. it happens — {night.film.title.toLowerCase()} is still on your list.
      </p>
    </div>
  );
}

// ── MN28 — the rescheduled night (still active) ─────────────────────────

export function RescheduledBlock({ night }: { night: MovieNightView }) {
  if (!night.previousScheduledFor) return null;
  return (
    <div className="mb-5 border-y border-hair py-4 text-center">
      <div className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-warning">
        <History className="h-[13px] w-[13px]" strokeWidth={2.2} />
        rescheduled
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-2.5">
        <span className="font-mono text-[15px] font-bold tabular-nums text-faint line-through">
          {formatNightDate(night.previousScheduledFor, night.tzOffsetMinutes)}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" strokeWidth={2.2} />
        <span className="font-mono text-[19px] font-bold tabular-nums tracking-[-0.02em] text-foreground">
          {formatNightDate(night.scheduledFor, night.tzOffsetMinutes)}
        </span>
      </div>
      <p className="mt-2 font-mono text-[10.5px] text-muted-foreground">
        {formatNightTime(night.scheduledFor, night.tzOffsetMinutes)} · same crew
      </p>
    </div>
  );
}

/** MN28 footer — a friendly re-confirm for an invitee who was already 'in'
 *  before the reschedule (RSVPs aren't reset by a reschedule — "same crew" —
 *  so this is a nudge + one-tap re-affirm, not a fresh choice). */
export function RescheduledInBar({
  onConfirm, onChangeAnswer, submitting,
}: { onConfirm: () => void; onChangeAnswer: () => void; submitting: boolean }) {
  return (
    <div>
      <button
        type="button"
        disabled={submitting}
        onClick={onConfirm}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] bg-primary font-headline text-[17px] font-bold lowercase tracking-[-0.02em] text-primary-foreground shadow-fab transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        <Check className="h-[19px] w-[19px]" strokeWidth={2.6} />
        i&apos;m still in
      </button>
      <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground">same crew, new time</p>
      <button
        type="button"
        onClick={onChangeAnswer}
        className="mt-1 flex h-9 w-full items-center justify-center font-ui text-[12.5px] font-semibold text-muted-foreground active:opacity-60"
      >
        change my answer
      </button>
    </div>
  );
}
