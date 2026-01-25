'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ExternalLink, Users, Instagram, Youtube, X, Film, Tv, Info, MessageSquare } from 'lucide-react';
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

function IMDbLogo({ className = 'h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 32" className={className} fill="currentColor">
      <rect width="64" height="32" rx="4" fill="#F5C518" />
      <text
        x="32"
        y="23"
        textAnchor="middle"
        fill="black"
        fontSize="18"
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        IMDb
      </text>
    </svg>
  );
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
      // Use server action to fetch IMDB rating (keeps API key server-side)
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
      // Use server action to fetch IMDB rating (keeps API key server-side)
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
};

export function PublicMovieDetailsModal({
  movie,
  isOpen,
  onClose,
  listId,
  listOwnerId,
}: PublicMovieDetailsModalProps) {
  const router = useRouter();
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(null);
  const [mediaDetailsForId, setMediaDetailsForId] = useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Use shared hook for viewport height (fixes iOS Safari issue)
  const drawerHeight = useViewportHeight(85);

  // Get TMDB ID for reviews
  const tmdbId = movie?.tmdbId || (movie?.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Reset state when movie changes
  useEffect(() => {
    if (movie) {
      // Only clear media details if switching to a different movie
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
    // Pass return context so back navigation can return to the list
    if (listId) params.set('returnListId', listId);
    if (listOwnerId) params.set('returnListOwnerId', listOwnerId);
    if (movie.id) params.set('returnMovieId', movie.id);
    onClose(); // Close the drawer first
    router.push(`/movie/${tmdbId}/comments?${params.toString()}`);
  };

  // Fetch movie/TV details when modal opens
  useEffect(() => {
    async function loadDetails() {
      // Skip if no movie, modal closed, or already loading
      if (!movie || !isOpen || isLoadingDetails) return;

      // Skip if we already have details for this movie
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

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-[3px] border-black border-b-0 outline-none"
          style={{
            height: drawerHeight > 0 ? `${drawerHeight}px` : 'calc(85 * var(--dvh, 1vh))',
            maxHeight: drawerHeight > 0 ? `${drawerHeight}px` : 'calc(85 * var(--dvh, 1vh))'
          }}
        >
          {/* Drag handle */}
          <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

          {/* Header */}
          <div className="relative px-6 pt-4 pb-4 border-b border-border flex-shrink-0">
            <Drawer.Title className="text-2xl font-headline flex items-center gap-2 pr-10">
              {movie.mediaType === 'tv' ? (
                <Tv className="h-6 w-6 text-primary flex-shrink-0" />
              ) : (
                <Film className="h-6 w-6 text-muted-foreground flex-shrink-0" />
              )}
              <span className="truncate">{movie.title}</span>
              <span className="text-muted-foreground font-normal text-lg flex-shrink-0">({movie.year})</span>
            </Drawer.Title>
            <Drawer.Close className="absolute right-4 top-4 p-1 rounded-full hover:bg-secondary transition-colors">
              <X className="h-5 w-5" />
            </Drawer.Close>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left: Poster + Video */}
                  <div className="space-y-4">
                    <Image
                      src={movie.posterUrl}
                      alt={`Poster for ${movie.title}`}
                      width={200}
                      height={300}
                      className="rounded-lg border-[3px] border-border shadow-[4px_4px_0px_0px_hsl(var(--border))] w-full max-w-[200px] h-auto mx-auto md:mx-0"
                    />

                    {hasEmbeddableVideo && (
                      <div>
                        <h3 className="font-bold mb-2 flex items-center gap-2">
                          {SocialIcon && <SocialIcon className="h-4 w-4" />}
                          {getProviderDisplayName(parsedVideo?.provider || null)} Video
                        </h3>
                        <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />
                      </div>
                    )}

                    {movie.socialLink && (
                      <Button asChild variant="outline" className="w-full">
                        <Link href={movie.socialLink} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open in {hasEmbeddableVideo ? getProviderDisplayName(parsedVideo?.provider || null) : 'Browser'}
                        </Link>
                      </Button>
                    )}
                  </div>

                  {/* Right: Details */}
                  <div className="space-y-4">
                    {/* IMDB Rating */}
                    {isLoadingDetails ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading rating...
                      </div>
                    ) : mediaDetails?.imdbRating && mediaDetails.imdbRating !== 'N/A' ? (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-[#F5C518] text-black px-3 py-1.5 rounded-lg font-bold">
                          <IMDbLogo className="h-5 w-auto" />
                          <span className="text-lg">{mediaDetails.imdbRating}</span>
                          <span className="text-sm font-normal">/10</span>
                        </div>
                        {mediaDetails.imdbVotes && (
                          <span className="text-sm text-muted-foreground">
                            ({mediaDetails.imdbVotes} votes)
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Runtime/Seasons & Genres */}
                    {mediaDetails && (
                      <div className="flex flex-wrap gap-2">
                        {'runtime' in mediaDetails && mediaDetails.runtime && (
                          <span className="bg-secondary px-2 py-1 rounded text-sm">
                            {Math.floor(mediaDetails.runtime / 60)}h {mediaDetails.runtime % 60}m
                          </span>
                        )}
                        {'number_of_seasons' in mediaDetails && (
                          <>
                            <span className="bg-secondary px-2 py-1 rounded text-sm">
                              {mediaDetails.number_of_seasons} Season{mediaDetails.number_of_seasons !== 1 ? 's' : ''}
                            </span>
                            <span className="bg-secondary px-2 py-1 rounded text-sm">
                              {mediaDetails.number_of_episodes} Episodes
                            </span>
                          </>
                        )}
                        {mediaDetails.genres?.map((genre) => (
                          <span key={genre.id} className="bg-secondary px-2 py-1 rounded text-sm">
                            {genre.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Overview */}
                    <div>
                      <h3 className="font-bold mb-2">Overview</h3>
                      {isLoadingDetails ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading details...
                        </div>
                      ) : mediaDetails?.overview || movie.overview ? (
                        <p className="text-muted-foreground leading-relaxed">
                          {mediaDetails?.overview || movie.overview}
                        </p>
                      ) : (
                        <p className="text-muted-foreground italic">No overview available</p>
                      )}
                    </div>

                    {/* Cast */}
                    {mediaDetails?.credits?.cast && mediaDetails.credits.cast.length > 0 && (
                      <div>
                        <h3 className="font-bold mb-2 flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Cast
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          {mediaDetails.credits.cast.slice(0, 6).map((actor: TMDBCast) => (
                            <div key={actor.id} className="flex items-center gap-2 bg-secondary rounded-lg p-2">
                              {actor.profile_path ? (
                                <Image
                                  src={`https://image.tmdb.org/t/p/w92${actor.profile_path}`}
                                  alt={actor.name}
                                  width={32}
                                  height={32}
                                  className="rounded-full object-cover w-8 h-8"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                  <span className="text-xs">{actor.name.charAt(0)}</span>
                                </div>
                              )}
                              <div className="overflow-hidden">
                                <p className="font-bold text-sm truncate">{actor.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{actor.character}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* IMDB Link */}
                    {mediaDetails?.imdbId && (
                      <Button asChild variant="outline" className="w-full">
                        <Link
                          href={`https://www.imdb.com/title/${mediaDetails.imdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <IMDbLogo className="h-4 w-auto mr-2" />
                          View on IMDb
                        </Link>
                      </Button>
                    )}

                    {/* Status (read-only) */}
                    <div className="pt-4 border-t">
                      <h3 className="font-bold mb-2">Status</h3>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-bold ${
                          movie.status === 'Watched'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}
                      >
                        {movie.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
          </div>

          {/* Bottom bar with Info/Reviews - Reviews navigates to full page */}
          <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex gap-2 justify-center">
              <button
                className="flex-1 max-w-[150px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all bg-primary text-primary-foreground shadow-[3px_3px_0px_0px_hsl(var(--border))]"
              >
                <Info className="h-4 w-4" />
                Info
              </button>
              <button
                onClick={handleOpenFullComments}
                className="flex-1 max-w-[150px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all bg-secondary text-muted-foreground hover:text-foreground"
              >
                <MessageSquare className="h-4 w-4" />
                Reviews
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
