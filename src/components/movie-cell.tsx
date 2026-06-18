'use client';

import Image from 'next/image';
import { memo, useMemo, useTransition } from 'react';
import {
  EyeOff, Eye, Check, Maximize2, Instagram, Youtube, Tv, Loader2, Trash2,
} from 'lucide-react';

import type { Movie } from '@/lib/types';
import { parseVideoUrl } from '@/lib/video-utils';
import { useUser } from '@/firebase';
import { useUserRatingsCache } from '@/contexts/user-ratings-cache';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { TiktokIcon } from './icons';
import { getRatingStyle } from '@/lib/utils';

/**
 * Shared movie cells — the ONE grid tile + list row used by both the editable
 * list (`/lists/[listId]`) and the read-only public list
 * (`/profile/[username]/lists/[listId]`). Previously these were two divergent
 * forks (movie-card-* vs public-movie-*) that drifted apart on every v3 change;
 * this is the single source of truth so they can never diverge again.
 *
 * Universal by construction:
 *   • Works logged-OUT (public viewers) — never returns null on no user.
 *   • `canEdit` gates every mutating affordance (none render for non-editors).
 *   • Rating shown is the VIEWER'S OWN score (from the ratings cache), labelled
 *     "your rating" — consistent on both surfaces, never an ambiguous number.
 *   • Optional data (added-by, social link, TV badge) renders only when present
 *     in the payload, so the read-only twin is never strictly poorer. (Notes
 *     live on the dedicated `notes` tab — see v3/notes-board.tsx — not here.)
 *   • Real button semantics + keyboard activation on the tap target.
 */

// next/image throws on an empty `src`; old imports / data drift can leave a
// blank posterUrl. Guarding here (the ONE shared cell) means neither list can
// blank out — including for logged-out visitors on the public page.
const POSTER_FALLBACK = 'https://picsum.photos/seed/cinechrony/500/750';

function getProviderIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  switch (parsed.provider) {
    case 'tiktok': return TiktokIcon;
    case 'instagram': return Instagram;
    case 'youtube': return Youtube;
    default: return null;
  }
}

function tmdbIdOf(movie: Movie): number {
  return movie.tmdbId || (movie.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);
}

type MovieCellProps = {
  movie: Movie;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
  onOpenDetails?: (movie: Movie) => void;
};

// Shared keyboard handler so a non-<button> tap target still activates on
// Enter/Space (and Space doesn't scroll the page).
function tapKeyDown(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

/* ───────────────────────── grid tile ───────────────────────── */

// NOTE: the grid tile is view-only by design — it exposes NO mutating
// affordance, so it doesn't read `canEdit`/`listId` (those gate the row's
// actions). Tapping always opens the drawer.
export const MovieCellGrid = memo(function MovieCellGrid({
  movie,
  listOwnerId,
  onOpenDetails,
}: MovieCellProps) {
  const { user } = useUser();
  const { getRating } = useUserRatingsCache();

  const tmdbId = tmdbIdOf(movie);
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);

  // Live profile cache override of the add-time denormalized snapshot.
  const isAddedByCurrentUser = !!user && movie.addedBy === user.uid;
  const liveAdder = useUserProfile(isAddedByCurrentUser ? null : movie.addedBy);
  const addedByName = useMemo(() => {
    if (isAddedByCurrentUser) return 'You';
    return liveAdder?.displayName || movie.addedByDisplayName || movie.addedByUsername || null;
  }, [isAddedByCurrentUser, liveAdder?.displayName, movie.addedByDisplayName, movie.addedByUsername]);
  const addedByInitial = addedByName ? addedByName.charAt(0).toUpperCase() : null;

  const handleClick = () => onOpenDetails?.(movie);

  const SocialIcon = getProviderIcon(movie.socialLink);
  const hasSocialLink = !!SocialIcon;
  const posterSrc = movie.posterUrl || POSTER_FALLBACK;

  // The visual badges (rating / status / TV) are title-only, which screen
  // readers don't announce — fold their state into the tap target's name.
  const ariaLabel = [
    movie.title,
    movie.mediaType === 'tv' ? 'TV show' : null,
    userRating !== null ? `your rating ${userRating.toFixed(1)} out of 10` : null,
    movie.status === 'Watched' ? 'watched' : 'to watch',
    hasSocialLink ? 'has video link' : null,
  ].filter(Boolean).join(', ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${ariaLabel}. View details`}
      className="group relative cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      onClick={handleClick}
      onKeyDown={tapKeyDown(handleClick)}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-[14px] overflow-hidden border border-border shadow-lift transition-all duration-200 md:group-hover:shadow-photo md:group-hover:-translate-y-0.5">
        <Image
          src={posterSrc}
          alt={movie.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
        />

        {/* Top row: rating + TV badge · social — decorative; state is in aria-label */}
        <div aria-hidden className="absolute top-1 left-1 right-1 flex justify-between items-start">
          <div className="flex items-center gap-1">
            {userRating !== null ? (
              <div
                className="px-1.5 py-0.5 rounded font-headline font-bold text-xs tabular-nums"
                style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
                title={`Your rating: ${userRating.toFixed(1)}/10`}
              >
                {userRating.toFixed(1)}
              </div>
            ) : null}
            {movie.mediaType === 'tv' && (
              <div className="bg-black/55 backdrop-blur-sm text-white p-1 rounded-md flex items-center" title="TV Show">
                <Tv className="h-3 w-3" strokeWidth={1.8} />
              </div>
            )}
          </div>

          {hasSocialLink && (
            <div className="bg-black/55 backdrop-blur-sm text-white p-1 rounded-md" title="Has video link">
              <SocialIcon className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Bottom row: added-by · status — decorative */}
        <div aria-hidden className="absolute bottom-1 left-1 right-1 flex justify-between items-end">
          <div className="flex items-center gap-1">
            {addedByInitial && listOwnerId && (
              <div
                className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-headline font-bold flex items-center justify-center ring-2 ring-white/70"
                title={`Added by ${addedByName}`}
              >
                {addedByInitial}
              </div>
            )}
          </div>

          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center ring-1 ring-white/70 ${
              movie.status === 'Watched'
                ? 'bg-[oklch(0.52_0.11_150)]'
                : 'bg-black/50 backdrop-blur-sm'
            }`}
            title={movie.status}
          >
            {movie.status === 'Watched' ? (
              <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
            ) : (
              <EyeOff className="h-3 w-3 text-white" strokeWidth={1.8} />
            )}
          </div>
        </div>

        {/* Hover overlay — desktop only */}
        <div aria-hidden className="absolute inset-0 bg-black/50 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="flex items-center gap-1.5 text-white text-sm bg-black/60 px-3 py-1.5 rounded-full">
            <Maximize2 className="h-4 w-4" />
            <span className="font-medium">View Details</span>
          </div>
        </div>
      </div>

      {/* Title + year (notes live on the dedicated notes tab now) */}
      <div className="mt-1.5 px-0.5">
        <p className="text-[13px] font-headline font-semibold lowercase tracking-tight truncate leading-tight" title={movie.title}>
          {movie.title}
        </p>
        <p className="cc-meta text-[11px] text-muted-foreground">{movie.year}</p>
      </div>
    </div>
  );
});

/* ───────────────────────── list row ───────────────────────── */

export const MovieCellRow = memo(function MovieCellRow({
  movie,
  listId,
  listOwnerId,
  canEdit = false,
  onOpenDetails,
}: MovieCellProps) {
  const [isPending, startTransition] = useTransition();
  const { user } = useUser();
  const { toast } = useToast();
  const { getRating } = useUserRatingsCache();

  const tmdbId = tmdbIdOf(movie);
  const userRating = useMemo(() => getRating(tmdbId), [getRating, tmdbId]);
  const ratingStyle = useMemo(() => getRatingStyle(userRating), [userRating]);

  const isAddedByCurrentUser = !!user && movie.addedBy === user.uid;
  const liveAdder = useUserProfile(isAddedByCurrentUser ? null : movie.addedBy);
  const addedByName = useMemo(() => {
    if (isAddedByCurrentUser) return user?.displayName || user?.email?.split('@')[0] || 'You';
    return liveAdder?.displayName || movie.addedByDisplayName || movie.addedByUsername || null;
  }, [isAddedByCurrentUser, user?.displayName, user?.email, liveAdder?.displayName, movie.addedByDisplayName, movie.addedByUsername]);

  const effectiveOwnerId = listOwnerId || user?.uid;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!listId || !effectiveOwnerId) return;
    const newStatus = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
    startTransition(() => {
      void apiCall(
        'PATCH',
        `/api/v1/lists/${effectiveOwnerId}/${listId}/movies/${movie.id}`,
        { status: newStatus },
      ).catch((err) => {
        toast({
          variant: 'destructive',
          title: 'Update failed',
          description: err instanceof ApiClientError ? err.message : 'Failed to update status.',
        });
      });
    });
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!listId || !effectiveOwnerId) return;
    startTransition(() => {
      void apiCall(
        'DELETE',
        `/api/v1/lists/${effectiveOwnerId}/${listId}/movies/${movie.id}`,
      ).catch((err) => {
        toast({
          variant: 'destructive',
          title: 'Remove failed',
          description: err instanceof ApiClientError ? err.message : 'Failed to remove movie.',
        });
      });
      const itemType = movie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      toast({ title: `${itemType} Removed`, description: `${movie.title} has been removed from your list.` });
    });
  };

  const handleClick = () => onOpenDetails?.(movie);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View details for ${movie.title}`}
      className="group rounded-[16px] border border-hair bg-card cursor-pointer transition-all duration-200 md:hover:shadow-press overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      onClick={handleClick}
      onKeyDown={tapKeyDown(handleClick)}
    >
      <div className="flex gap-3 p-3">
        {/* Poster chip — v3 48×72 */}
        <div className="relative w-12 h-[72px] flex-shrink-0 rounded-[10px] overflow-hidden border border-hair">
          <Image src={movie.posterUrl || POSTER_FALLBACK} alt={movie.title} fill className="object-cover" sizes="48px" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              {movie.mediaType === 'tv' && (
                <Tv className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" strokeWidth={1.9} />
              )}
              <h3
                className="font-headline font-bold text-[16px] lowercase tracking-[-0.02em] truncate leading-tight"
                title={movie.title}
              >
                {movie.title}
              </h3>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{movie.year}</p>
          </div>

          {addedByName && (
            <p className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
              added by {addedByName}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end justify-between">
          <div className="flex items-center gap-1.5">
            {/* viewer's own rating sticker */}
            {userRating !== null && (
              <span
                className="px-1.5 py-0.5 rounded font-headline font-bold text-[11px] tabular-nums"
                style={{ ...ratingStyle.background, ...ratingStyle.textOnBg }}
                title={`Your rating: ${userRating.toFixed(1)}/10`}
              >
                {userRating.toFixed(1)}
              </span>
            )}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full border border-hair cc-meta text-[10px] lowercase ${
                movie.status === 'Watched' ? 'text-success' : 'text-muted-foreground'
              }`}
            >
              {movie.status}
            </span>
          </div>

          {canEdit && (
            <div className="flex gap-1 mt-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full"
                onClick={handleToggle}
                disabled={isPending}
                aria-label={movie.status === 'To Watch' ? 'Mark watched' : 'Mark to watch'}
                title={movie.status === 'To Watch' ? 'Mark Watched' : 'Mark To Watch'}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : movie.status === 'To Watch' ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full text-destructive hover:text-destructive"
                onClick={handleRemove}
                disabled={isPending}
                aria-label="Remove from list"
                title="Remove movie"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
