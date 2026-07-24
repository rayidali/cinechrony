'use client';

import { useEffect, useRef } from 'react';
import { Pin } from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { useCachedAction } from '@/lib/use-cached-action';
import { cn } from '@/lib/utils';
import { MovieNightCard } from './movie-night-card';
import { useMovieNight } from './movie-night-provider';
import type { MovieNightView } from '@/lib/movie-night-types';

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

  if (!night) return null;

  return (
    <div className={cn('mb-5', className)}>
      <div className="mb-2.5 ml-0.5 flex items-center gap-1.5">
        <Pin className="h-3 w-3 text-primary" strokeWidth={2.2} />
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-primary">pinned · movie night</span>
      </div>
      <MovieNightCard night={night} onTap={() => openNight(night.id)} />
    </div>
  );
}
