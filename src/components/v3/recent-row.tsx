'use client';

import { ChevronRight, Plus, Star, Eye, MessageCircle } from 'lucide-react';
import type { Activity, ActivityType, Movie } from '@/lib/types';
import { useMovieModal } from '@/contexts/movie-modal-context';
import { getRatingStyle } from '@/lib/utils';

/**
 * RecentRow — v3 activity row (Phase 0.7). A compact line for the profile's
 * "recent" section and "activity" tab (design: ios-screens.jsx `RecentRow`):
 * small poster · type badge (+ rating chip for `rated`) · lowercase title ·
 * mono "to {list} · {time}" meta · chevron. Tapping opens the movie modal.
 *
 * Universal: the single row primitive for any owner-scoped activity stream
 * (own profile recent + activity, public profile, etc).
 */

/** Compact relative time — "now · 4m · 2h · 3d · 12.05" (matches the design's mono meta).
 * Accepts a JS Date OR a Firestore Timestamp (useCollection returns raw doc data). */
function relTime(value: unknown): string {
  const v = value as { toDate?: () => Date } | Date | string | number | null | undefined;
  let date: Date;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    date = (v as { toDate: () => Date }).toDate();
  } else if (v instanceof Date) {
    date = v;
  } else if (v != null) {
    date = new Date(v as string | number);
  } else {
    return '';
  }
  if (isNaN(date.getTime())) return '';
  const ms = Date.now() - date.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function BadgeIcon({ type }: { type: ActivityType }) {
  const props = { className: 'h-3 w-3', strokeWidth: 1.8 as const };
  switch (type) {
    case 'added':
      return <Plus {...props} />;
    case 'rated':
      return <Star {...props} />;
    case 'watched':
      return <Eye {...props} />;
    case 'reviewed':
      return <MessageCircle {...props} />;
    default:
      return null;
  }
}

/** Build the minimal Movie the modal needs from a denormalized Activity. */
function activityToMovie(a: Activity): Movie {
  return {
    id: `${a.mediaType}_${a.tmdbId}`,
    title: a.movieTitle,
    year: a.movieYear || '',
    posterUrl: a.moviePosterUrl || '',
    posterHint: `${a.movieTitle} poster`,
    addedBy: '',
    status: 'To Watch',
    mediaType: a.mediaType,
    tmdbId: a.tmdbId,
  };
}

export function RecentRow({ activity, last }: { activity: Activity; last?: boolean }) {
  const { openMovie } = useMovieModal();
  const ratingStyle = activity.rating != null ? getRatingStyle(activity.rating) : null;

  return (
    <button
      onClick={() => openMovie(activityToMovie(activity))}
      className="relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-foreground/[0.03]"
    >
      <div className="h-[52px] w-9 flex-shrink-0 overflow-hidden rounded-md border border-hair bg-secondary">
        {activity.moviePosterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activity.moviePosterUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-rule px-2 py-0.5 font-mono text-[10px] lowercase text-muted-foreground">
            <BadgeIcon type={activity.type} />
            {activity.type}
          </span>
          {activity.type === 'rated' && activity.rating != null && ratingStyle && (
            <span
              className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums"
              style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
            >
              {activity.rating.toFixed(1)}
            </span>
          )}
        </div>
        <div className="mt-1.5 truncate font-headline text-[14.5px] font-semibold lowercase leading-tight tracking-tight text-foreground">
          {activity.movieTitle}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {activity.type === 'added' && activity.listName ? `to ${activity.listName} · ` : ''}
          {relTime(activity.createdAt)}
        </div>
      </div>

      <ChevronRight className="h-[17px] w-[17px] flex-shrink-0 text-faint" strokeWidth={1.8} />

      {!last && <div className="absolute bottom-0 left-[60px] right-0 h-px bg-rule" />}
    </button>
  );
}
