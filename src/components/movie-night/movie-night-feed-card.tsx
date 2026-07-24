'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-avatar';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { track, AnalyticsEvent } from '@/lib/analytics';
import { formatNightWeekdayFull } from '@/lib/movie-night-format';
import { MovieNightCard } from './movie-night-card';
import { useMovieNight } from './movie-night-provider';
import type { MovieNightView } from '@/lib/movie-night-types';

/**
 * MN15 — the soonest upcoming movie night as a borderless diary entry near
 * the top of the home feed (MOVIE-NIGHT-PLAN.md § S3b). No heart/comment
 * row — the design shows one, but a movie night isn't a post; wiring likes
 * to a non-post object would be fake, so it's just the byline, the eyebrow,
 * the compact card, and (when the viewer hasn't answered) a one-tap "i'm in"
 * pill. Tapping the card itself opens the detail sheet.
 */
export function MovieNightFeedCard({ night }: { night: MovieNightView }) {
  const { openNight, refreshUpcoming } = useMovieNight();
  const [answered, setAnswered] = useState(!!night.viewer.answer || night.viewer.isHost);
  const [submitting, setSubmitting] = useState(false);

  const hostInvitee = night.invitees.find((i) => i.isHost) ?? null;
  const hostLabel = hostInvitee?.username ? `@${hostInvitee.username}` : hostInvitee?.displayName || 'someone';
  const weekdayEyebrow = `${formatNightWeekdayFull(night.scheduledFor, night.tzOffsetMinutes)} night`;

  async function handleImIn() {
    if (submitting || answered) return;
    haptic('light');
    setSubmitting(true);
    try {
      await apiCall('POST', `/api/v1/movie-nights/${night.id}/rsvp`, { answer: 'in' });
      haptic('success');
      setAnswered(true);
      track(AnalyticsEvent.MovieNightRsvp, { answer: 'in', surface: 'feed' });
      refreshUpcoming();
    } catch (err) {
      haptic('error');
      if (!(err instanceof ApiClientError)) throw err;
      // Non-critical — the pill just stays tappable so the viewer can retry.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="py-5">
      <div className="flex items-center gap-2.5">
        <ProfileAvatar photoURL={hostInvitee?.photoURL} displayName={hostInvitee?.displayName} username={hostInvitee?.username} size="md" />
        <div className="min-w-0 flex-1">
          <div className="font-ui text-[15px] font-bold text-foreground">
            {hostLabel} <span className="font-normal text-muted-foreground">planned a movie night</span>
          </div>
          {night.listName && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{night.listName.toLowerCase()}</div>}
        </div>
      </div>

      <p className="mt-2.5 font-headline text-[16.5px] font-bold leading-[1.32] tracking-[-0.03em] text-foreground">
        <span className="mr-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-primary">{weekdayEyebrow}</span>
        who&apos;s coming?
      </p>

      <div className="mt-3">
        <MovieNightCard night={night} onTap={() => openNight(night.id)} />
      </div>

      {!answered && (
        <div className="mt-3.5 flex justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={handleImIn}
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-headline text-[13px] font-bold lowercase text-primary-foreground transition-transform active:scale-95 disabled:opacity-60"
          >
            <Check className="h-[14px] w-[14px]" strokeWidth={2.6} />
            i&apos;m in
          </button>
        </div>
      )}
    </div>
  );
}
