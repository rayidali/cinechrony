'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
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
  Star,
  Calendar,
} from 'lucide-react';
import { Drawer } from 'vaul';

import type { Movie, TMDBMovieDetails, TMDBTVDetails, TMDBCast } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { Button } from '@/components/ui/button';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { getImdbRating } from '@/app/actions';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

type ExtendedMovieDetails = TMDBMovieDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

type ExtendedTVDetails = TMDBTVDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

type MediaDetails = ExtendedMovieDetails | ExtendedTVDetails;

const GLASS_BTN =
  'w-9 h-9 rounded-xl bg-black/35 backdrop-blur-md text-white flex items-center justify-center border border-white/15 transition-transform active:scale-95';

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

async function fetchMovieDetails(tmdbId: number): Promise<ExtendedMovieDetails | null> {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const response = await fetch(
      `${TMDB_API_BASE_URL}/movie/${tmdbId}?append_to_response=credits,external_ids`,
      {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const imdbId = data.external_ids?.imdb_id;

    if (imdbId) {
      const omdbData = await getImdbRating(imdbId);
      if (omdbData.imdbRating) {
        return { ...data, imdbId, imdbRating: omdbData.imdbRating, imdbVotes: omdbData.imdbVotes };
      }
    }

    return { ...data, imdbId };
  } catch {
    return null;
  }
}

async function fetchTVDetails(tmdbId: number): Promise<ExtendedTVDetails | null> {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const response = await fetch(
      `${TMDB_API_BASE_URL}/tv/${tmdbId}?append_to_response=credits,external_ids`,
      {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const imdbId = data.external_ids?.imdb_id;

    if (imdbId) {
      const omdbData = await getImdbRating(imdbId);
      if (omdbData.imdbRating) {
        return { ...data, imdbId, imdbRating: omdbData.imdbRating, imdbVotes: omdbData.imdbVotes };
      }
    }

    return { ...data, imdbId };
  } catch {
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
  movie,
  isOpen,
  onClose,
  listId,
  listOwnerId,
  returnPath,
}: PublicMovieDetailsModalProps) {
  const router = useRouter();
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(null);
  const [mediaDetailsForId, setMediaDetailsForId] = useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Use shared hook for viewport height (fixes iOS Safari issue)
  const drawerHeight = useViewportHeight(92);

  // Get TMDB ID for reviews
  const tmdbId = movie?.tmdbId || (movie?.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Reset state when movie changes
  useEffect(() => {
    if (movie) {
      if (mediaDetailsForId !== movie.id) {
        setMediaDetails(null);
        setMediaDetailsForId(null);
      }
    }
  }, [movie?.id, mediaDetailsForId]);

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
    onClose();
    router.push(`/movie/${tmdbId}/comments?${params.toString()}`);
  };

  // Fetch movie/TV details when modal opens
  useEffect(() => {
    async function loadDetails() {
      if (!movie || !isOpen || isLoadingDetails) return;
      if (mediaDetailsForId === movie.id && mediaDetails) return;

      setIsLoadingDetails(true);
      let tmdbIdLocal: number;
      if (movie.tmdbId) {
        tmdbIdLocal = movie.tmdbId;
      } else {
        const idMatch = movie.id.match(/^(?:movie|tv)_(\d+)$/);
        tmdbIdLocal = idMatch ? parseInt(idMatch[1], 10) : parseInt(movie.id, 10);
      }

      if (!isNaN(tmdbIdLocal)) {
        const details = movie.mediaType === 'tv'
          ? await fetchTVDetails(tmdbIdLocal)
          : await fetchMovieDetails(tmdbIdLocal);
        setMediaDetails(details);
        setMediaDetailsForId(movie.id);
      }
      setIsLoadingDetails(false);
    }
    loadDetails();
  }, [movie?.id, isOpen, mediaDetailsForId, mediaDetails, isLoadingDetails]);

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
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </div>

          {/* Scrollable — hero + content sheet */}
          <div className="flex-1 min-h-0 overflow-y-auto">
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
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/80" />
              <Drawer.Title
                className="absolute bottom-7 left-5 right-5 font-headline font-bold text-white text-3xl lowercase tracking-tight leading-[0.95]"
                style={{ textShadow: '0 1px 8px rgba(0,0,0,0.55)' }}
              >
                {movie.title}
              </Drawer.Title>
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

              <h2 className="font-headline font-bold text-2xl lowercase tracking-tight leading-[0.95] mt-2.5">
                {movie.title}
              </h2>

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
                      <Star className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                      imdb {mediaDetails.imdbRating}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Star className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                      imdb {mediaDetails.imdbRating}
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

              {/* Description */}
              {overview ? (
                <p className="font-serif text-[15px] leading-relaxed text-foreground">{overview}</p>
              ) : !isLoadingDetails ? (
                <p className="font-serif italic text-sm text-muted-foreground">no overview available</p>
              ) : null}

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

              {/* Reviews link */}
              <section className="mt-6">
                <div className="cc-eyebrow">reviews</div>
                <div className="h-px bg-border my-3" />
                <button
                  onClick={handleOpenFullComments}
                  className="w-full flex items-center justify-between gap-3 group"
                >
                  <span className="font-serif italic text-[15px] text-muted-foreground text-left">
                    read what people are saying…
                  </span>
                  <span className="cc-meta text-[11px] text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0">
                    see all →
                  </span>
                </button>
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
