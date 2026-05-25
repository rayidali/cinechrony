'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  ExternalLink,
  Instagram,
  Youtube,
  Film,
  Tv,
  ChevronLeft,
  Clock,
  Calendar,
} from 'lucide-react';
import { Drawer } from 'vaul';

import type { Movie, TMDBCast, Review } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { Button } from '@/components/ui/button';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { getMovieReviews } from '@/app/actions';
import { formatDistanceToNow } from 'date-fns';
import { ImdbLogo } from './imdb-logo';
import { SimilarMoviesRow } from './similar-movies-row';
import {
  type MediaDetails,
  getCachedDetails,
  getMovieOrTVDetails,
} from '@/lib/tmdb-details-cache';
import { rememberMovieForReturn } from '@/contexts/movie-modal-context';

const GLASS_BTN =
  'w-11 h-11 rounded-xl bg-black/35 backdrop-blur-md text-white flex items-center justify-center border border-white/15 transition-transform active:scale-95';

function getProviderIcon(url: string | undefined) {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  switch (parsed.provider) {
    case 'tiktok':
      return TiktokIcon;
    case 'instagram':
      return Instagram;
    case 'youtube':
      return Youtube;
    default:
      return null;
  }
}

type PublicMovieDetailsModalProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  listId?: string;
  listOwnerId?: string;
  /** Full path to return to (e.g., /profile/username/lists/listId) - used by comments page back navigation */
  returnPath?: string;
};

/**
 * Public movie detail — the read-only twin of MovieDetailsModal.
 * Same cinematic-open pattern (full-bleed hero + content sheet), but no
 * watch-status / rating / marginalia editing. Used for trending movies and
 * public lists viewed by non-collaborators.
 */
export function PublicMovieDetailsModal({
  movie: movieProp,
  isOpen,
  onClose,
  listId,
  listOwnerId,
  returnPath,
}: PublicMovieDetailsModalProps) {
  const router = useRouter();
  // "more like this" can swap the modal to a different film in place — no
  // modal stacking. `override` holds the swapped-in film; null = the prop.
  const [override, setOverride] = useState<Movie | null>(null);
  const movie = override ?? movieProp;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Seed details from the module-level cache on first render so a re-open
  // paints the full payload on frame one. See `tmdb-details-cache.ts` for
  // the full rationale.
  const initialCached = useMemo(() => {
    if (!movie) return null;
    const mediaType = movie.mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbIdNum = movie.tmdbId
      || (movie.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);
    if (!tmdbIdNum || isNaN(tmdbIdNum)) return null;
    return getCachedDetails(mediaType, tmdbIdNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // First-render only — re-mounts (via key) get a fresh read.
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(initialCached);

  // Drop the override when the parent opens a different movie / the modal closes.
  useEffect(() => {
    setOverride(null);
  }, [movieProp?.id, isOpen]);
  const [mediaDetailsForId, setMediaDetailsForId] = useState<string | null>(
    initialCached && movie ? movie.id : null,
  );
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [reviewPreviews, setReviewPreviews] = useState<Review[]>([]);

  // Use shared hook for viewport height (fixes iOS Safari issue)
  const drawerHeight = useViewportHeight(92);

  // Get TMDB ID for reviews
  const tmdbId = movie?.tmdbId || (movie?.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Navigate to full-screen comments page
  const handleOpenFullComments = () => {
    if (!movie) return;
    const params = new URLSearchParams({
      title: movie.title,
      poster: movie.posterUrl || '',
      type: movie.mediaType || 'movie',
    });
    // SECURITY: Use returnPath to preserve original route (e.g., public profile view)
    if (returnPath) {
      params.set('returnPath', returnPath);
    }
    if (listId) params.set('returnListId', listId);
    if (listOwnerId) params.set('returnListOwnerId', listOwnerId);
    if (movie.id) params.set('returnMovieId', movie.id);

    // Persist the currently-displayed movie (which may be the "more like
    // this" override, not the prop) so the round-trip via /comments can
    // recall the right object on return. Without this, swapping films and
    // then tapping "see all reviews" would land back on the original film
    // (or nothing at all, if the override id never made it into storage).
    rememberMovieForReturn(movie);

    onClose();
    // Defer the navigation until Vaul has had a frame to commit the close
    // and run its body-style restore. Otherwise the route changes while the
    // drawer is mid-close, the cleanup races with unmount, and on return
    // body can be left scroll-locked — see [[body-style-watchdog]].
    setTimeout(() => {
      router.push(`/movie/${tmdbId}/comments?${params.toString()}`);
    }, 220);
  };

  // Load details via the module-level cache. See movie-details-modal.tsx
  // and tmdb-details-cache.ts for the full rationale.
  const loadDetailsCallRef = useRef(0);
  useEffect(() => {
    if (!movie || !isOpen) return;
    if (mediaDetailsForId === movie.id) return;

    const targetMovie = movie;
    const targetMediaType = targetMovie.mediaType === 'tv' ? 'tv' : 'movie';

    let tmdbIdLocal: number;
    if (targetMovie.tmdbId) {
      tmdbIdLocal = targetMovie.tmdbId;
    } else {
      const idMatch = targetMovie.id.match(/^(?:movie|tv)_(\d+)$/);
      tmdbIdLocal = idMatch
        ? parseInt(idMatch[1], 10)
        : parseInt(targetMovie.id, 10);
    }
    if (!tmdbIdLocal || isNaN(tmdbIdLocal)) return;

    // Paranoia: treat a cached payload missing the essential `overview` field
    // as a stale/partial cache (an aborted fetch in iOS PWA can land a
    // structurally-incomplete record). Force a refetch — getMovieOrTVDetails
    // will re-warm the cache on success.
    const cached = getCachedDetails(targetMediaType, tmdbIdLocal);
    const cachedIsUsable =
      cached &&
      typeof cached.overview === 'string' &&
      cached.overview.length > 0;
    if (cachedIsUsable) {
      setMediaDetails(cached);
      setMediaDetailsForId(targetMovie.id);
      return;
    }

    const myCallId = ++loadDetailsCallRef.current;
    (async () => {
      // If we have a non-empty (but suspect) cached payload, keep it on
      // screen as a placeholder while we refetch — avoids a flash to empty.
      if (cached) setMediaDetails(cached);
      setIsLoadingDetails(true);
      const details = await getMovieOrTVDetails(targetMediaType, tmdbIdLocal);
      if (loadDetailsCallRef.current !== myCallId) return;
      if (details) setMediaDetails(details);
      setMediaDetailsForId(targetMovie.id);
      setIsLoadingDetails(false);
    })();
  }, [movie?.id, isOpen, mediaDetailsForId]);

  // Fetch the most-liked reviews for the in-modal preview (non-critical).
  useEffect(() => {
    if (!isOpen || !tmdbId) {
      setReviewPreviews([]);
      return;
    }
    let cancelled = false;
    setReviewPreviews([]);
    (async () => {
      try {
        const result = await getMovieReviews(tmdbId, 'likes', 2);
        if (!cancelled) setReviewPreviews((result.reviews ?? []) as Review[]);
      } catch {
        /* the preview is non-critical — leave it empty on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, isOpen]);

  if (!movie) return null;

  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  const backdropPath =
    mediaDetails && 'backdrop_path' in mediaDetails ? mediaDetails.backdrop_path : null;
  const heroSrc = backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : movie.posterUrl;

  let runtimeLabel: string | null = null;
  if (mediaDetails) {
    if ('runtime' in mediaDetails && mediaDetails.runtime) {
      runtimeLabel = `${Math.floor(mediaDetails.runtime / 60)}h ${mediaDetails.runtime % 60}m`;
    } else if ('number_of_seasons' in mediaDetails) {
      runtimeLabel = `${mediaDetails.number_of_seasons} season${mediaDetails.number_of_seasons !== 1 ? 's' : ''}`;
    }
  }

  const cast = mediaDetails?.credits?.cast ?? [];
  const overview = mediaDetails?.overview || movie.overview;
  const heightStyle = drawerHeight > 0 ? `${drawerHeight}px` : 'calc(92 * var(--dvh, 1vh))';

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-card outline-none overflow-hidden"
          style={{ height: heightStyle, maxHeight: heightStyle }}
        >
          <Drawer.Description className="sr-only">Details for {movie.title}</Drawer.Description>

          {/* Glassy floating back control */}
          <div className="absolute top-3 left-3 z-30">
            <button onClick={onClose} className={GLASS_BTN} aria-label="Back">
              <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
          </div>

          {/* Scrollable — hero + content sheet */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            {/* Hero */}
            <div className="relative w-full" style={{ height: 'clamp(240px, 42vh, 360px)', background: 'oklch(0.165 0.012 60)' }}>
              <Image
                src={heroSrc}
                alt={`Poster art for ${movie.title}`}
                fill
                priority
                className="object-cover"
                sizes="100vw"
              />
              {/* scrim — keeps the glassy control legible; the title now
                  lives only once, in the content sheet below */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />
            </div>

            {/* Content sheet */}
            <div className="relative -mt-6 rounded-t-[26px] bg-card px-5 pt-2 pb-8">
              <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground">
                {movie.mediaType === 'tv' ? (
                  <Tv className="h-3 w-3" strokeWidth={1.8} />
                ) : (
                  <Film className="h-3 w-3" strokeWidth={1.8} />
                )}
                {movie.mediaType === 'tv' ? 'tv series' : 'film'}
              </span>

              <Drawer.Title className="font-headline font-bold text-2xl lowercase tracking-tight leading-[0.95] mt-2.5">
                {movie.title}
              </Drawer.Title>

              {/* Metric chips */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 cc-meta text-xs text-foreground">
                {runtimeLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                    {runtimeLabel}
                  </span>
                )}
                {mediaDetails?.imdbRating && mediaDetails.imdbRating !== 'N/A' && (
                  mediaDetails.imdbId ? (
                    <a
                      href={`https://www.imdb.com/title/${mediaDetails.imdbId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                    >
                      <ImdbLogo className="h-3.5" />
                      {mediaDetails.imdbRating}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <ImdbLogo className="h-3.5" />
                      {mediaDetails.imdbRating}
                    </span>
                  )
                )}
                {movie.year && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                    {movie.year}
                  </span>
                )}
                {isLoadingDetails && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Genres */}
              {mediaDetails?.genres && mediaDetails.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {mediaDetails.genres.map((genre) => (
                    <span
                      key={genre.id}
                      className="px-2 py-0.5 rounded-full border border-border cc-meta text-[10px] lowercase text-muted-foreground"
                    >
                      {genre.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="h-px bg-border my-4" />

              {/* Description — never silently null. While loading we show a
                  skeleton block; after load, if the payload genuinely has no
                  overview we say so. The old `null` branch was producing a
                  big empty cream gap on slow / aborted fetches. */}
              {overview ? (
                <p className="font-serif text-[15px] leading-relaxed text-foreground">{overview}</p>
              ) : isLoadingDetails ? (
                <div className="space-y-2" aria-label="Loading overview">
                  <div className="h-3.5 w-full rounded bg-muted animate-pulse" />
                  <div className="h-3.5 w-[92%] rounded bg-muted animate-pulse" />
                  <div className="h-3.5 w-[78%] rounded bg-muted animate-pulse" />
                </div>
              ) : (
                <p className="font-serif italic text-sm text-muted-foreground">no overview available</p>
              )}

              {/* Cast */}
              {cast.length > 0 && (
                <section className="mt-6">
                  <div className="cc-eyebrow">cast</div>
                  <div className="h-px bg-border my-3" />
                  <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-hide">
                    {cast.slice(0, 12).map((actor: TMDBCast) => (
                      <div key={actor.id} className="flex-shrink-0 w-14 text-center">
                        <div className="w-14 h-14 rounded-full overflow-hidden border border-border bg-muted relative">
                          {actor.profile_path ? (
                            <Image
                              src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`}
                              alt={actor.name}
                              fill
                              className="object-cover"
                              sizes="56px"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-headline font-bold text-sm text-muted-foreground">
                              {actor.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <p className="font-headline font-semibold text-[11px] lowercase tracking-tight truncate mt-1.5">
                          {actor.name}
                        </p>
                        <p className="cc-meta text-[9px] text-muted-foreground truncate">
                          {actor.character}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* More like this — TMDB recommendations, swaps the modal in place */}
              {tmdbId > 0 && (
                <SimilarMoviesRow
                  tmdbId={tmdbId}
                  mediaType={movie.mediaType === 'tv' ? 'tv' : 'movie'}
                  onPick={(picked) => {
                    setOverride(picked);
                    // Persist immediately so a subsequent "see all reviews"
                    // round-trip can recall the swapped-in film by id.
                    rememberMovieForReturn(picked);
                    scrollRef.current?.scrollTo({ top: 0 });
                  }}
                />
              )}

              {/* Reviews — featured pull-quotes, then the full discussion */}
              <section className="mt-6">
                <div className="cc-eyebrow">reviews</div>
                <div className="h-px bg-border my-3" />
                {reviewPreviews.length > 0 ? (
                  <div className="space-y-4">
                    {reviewPreviews.map((review) => (
                      <button
                        key={review.id}
                        onClick={handleOpenFullComments}
                        className="block w-full text-left pl-3 border-l-2 border-border"
                      >
                        <p className="font-serif italic text-[15px] leading-snug text-foreground line-clamp-3">
                          “{review.text}”
                        </p>
                        <p className="cc-meta text-[10px] text-muted-foreground mt-1.5">
                          — @{review.username || 'user'} ·{' '}
                          {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                        </p>
                      </button>
                    ))}
                    <button
                      onClick={handleOpenFullComments}
                      className="cc-meta text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      see all reviews →
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleOpenFullComments}
                    className="w-full flex items-center justify-between gap-3 group"
                  >
                    <span className="font-serif italic text-[15px] text-muted-foreground text-left">
                      be the first to review…
                    </span>
                    <span className="cc-meta text-[11px] text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0">
                      see all →
                    </span>
                  </button>
                )}
              </section>

              {/* The attached clip */}
              {(hasEmbeddableVideo || movie.socialLink) && (
                <section className="mt-6">
                  <div className="cc-eyebrow">the clip</div>
                  <div className="h-px bg-border my-3" />
                  {hasEmbeddableVideo && <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />}
                  {movie.socialLink && (
                    <Button asChild variant="outline" className="w-full mt-3">
                      <Link href={movie.socialLink} target="_blank" rel="noopener noreferrer">
                        {SocialIcon && <SocialIcon className="h-4 w-4 mr-2" />}
                        {hasEmbeddableVideo ? (
                          <>open in {getProviderDisplayName(parsedVideo?.provider || null)}</>
                        ) : (
                          <>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            open link
                          </>
                        )}
                      </Link>
                    </Button>
                  )}
                </section>
              )}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
