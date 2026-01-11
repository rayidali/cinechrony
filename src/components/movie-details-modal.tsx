'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  ExternalLink,
  Users,
  Instagram,
  Youtube,
  X,
  Film,
  Tv,
  Info,
  MessageSquare,
} from 'lucide-react';
import { Drawer } from 'vaul';

import type { Movie, TMDBMovieDetails, TMDBTVDetails, TMDBCast, UserProfile } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import { getUserProfile, getUserRating, createOrUpdateRating, deleteRating, createReview } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { ReviewsList } from './reviews-list';
import { RatingSlider } from './rating-slider';
import { useToast } from '@/hooks/use-toast';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { doc } from 'firebase/firestore';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_API_KEY = 'fc5ca6d0';

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

type ViewTab = 'info' | 'reviews';

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

const retroInputClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200';

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
      const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`);
      const omdbData = await omdbResponse.json();
      if (omdbData.Response === 'True') {
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
      const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`);
      const omdbData = await omdbResponse.json();
      if (omdbData.Response === 'True') {
        return { ...data, imdbId, imdbRating: omdbData.imdbRating, imdbVotes: omdbData.imdbVotes };
      }
    }

    return { ...data, imdbId };
  } catch {
    return null;
  }
}

type MovieDetailsModalProps = {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  listId?: string;
  listOwnerId?: string;
  canEdit?: boolean;
};

export function MovieDetailsModal({
  movie,
  isOpen,
  onClose,
  listId,
  listOwnerId,
  canEdit = true,
}: MovieDetailsModalProps) {
  const [isPending, startTransition] = useTransition();
  const [mediaDetails, setMediaDetails] = useState<MediaDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [newSocialLink, setNewSocialLink] = useState('');
  const [addedByUser, setAddedByUser] = useState<UserProfile | null>(null);
  const [localStatus, setLocalStatus] = useState<'To Watch' | 'Watched'>('To Watch');
  const [activeTab, setActiveTab] = useState<ViewTab>('info');
  const [userRating, setUserRating] = useState<number | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [showRateOnWatchModal, setShowRateOnWatchModal] = useState(false);
  const [rateModalRating, setRateModalRating] = useState(7);
  const [rateModalComment, setRateModalComment] = useState('');
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  // Use shared hook for viewport height (fixes iOS Safari issue)
  const drawerHeight = useViewportHeight(85);

  // Get TMDB ID for reviews
  const tmdbId = movie?.tmdbId || (movie?.id ? parseInt(movie.id.replace(/^(movie|tv)_/, ''), 10) : 0);

  // Reset state when movie changes
  useEffect(() => {
    if (movie) {
      setNewSocialLink(movie.socialLink || '');
      setMediaDetails(null);
      setAddedByUser(null);
      setLocalStatus(movie.status);
      setActiveTab('info');
      setUserRating(null);
      setShowRateOnWatchModal(false);
      setRateModalRating(7);
      setRateModalComment('');
    }
  }, [movie?.id, movie?.status]);

  // Fetch user's rating for this movie
  useEffect(() => {
    async function fetchUserRating() {
      if (!movie || !isOpen || !user?.uid || !tmdbId) return;

      try {
        const result = await getUserRating(user.uid, tmdbId);
        if (result.rating) {
          setUserRating(result.rating.rating);
        }
      } catch (error) {
        console.error('Failed to fetch user rating:', error);
      }
    }
    fetchUserRating();
  }, [movie?.id, isOpen, user?.uid, tmdbId]);

  // Fetch movie/TV details when modal opens
  useEffect(() => {
    async function loadDetails() {
      if (!movie || !isOpen || mediaDetails || isLoadingDetails) return;

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
      }
      setIsLoadingDetails(false);
    }
    loadDetails();
  }, [movie, isOpen]);

  // Fetch added by user
  useEffect(() => {
    async function fetchUser() {
      if (!movie?.addedBy) return;
      try {
        const result = await getUserProfile(movie.addedBy);
        if (result.user) setAddedByUser(result.user);
      } catch (error) {
        console.error('Failed to fetch addedBy user:', error);
      }
    }
    if (isOpen && movie) fetchUser();
  }, [movie?.addedBy, isOpen]);

  if (!movie || !user) return null;

  const effectiveOwnerId = listOwnerId || user.uid;
  const movieDocRef = listId
    ? doc(firestore, 'users', effectiveOwnerId, 'lists', listId, 'movies', movie.id)
    : doc(firestore, 'users', user.uid, 'movies', movie.id);

  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  const handleStatusChange = (newStatus: 'To Watch' | 'Watched') => {
    if (newStatus === localStatus) return;

    if (newStatus === 'Watched') {
      setShowRateOnWatchModal(true);
      return;
    }

    setLocalStatus(newStatus);
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: newStatus });
    });
  };

  const handleRateOnWatchSave = async (rating: number, comment: string) => {
    if (!user?.uid || !tmdbId) return;

    await createOrUpdateRating(
      user.uid,
      tmdbId,
      movie.mediaType || 'movie',
      movie.title,
      movie.posterUrl,
      rating
    );
    setUserRating(rating);

    if (comment.trim()) {
      await createReview(
        user.uid,
        tmdbId,
        movie.mediaType || 'movie',
        movie.title,
        movie.posterUrl,
        comment,
        rating
      );
    }

    setLocalStatus('Watched');
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
    });

    toast({
      title: 'Marked as Watched',
      description: `You rated ${movie.title} ${rating.toFixed(1)}/10`,
    });
  };

  const handleRateOnWatchSkip = () => {
    setLocalStatus('Watched');
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
    });
  };

  const handleRemove = () => {
    startTransition(() => {
      deleteDocumentNonBlocking(movieDocRef);
      const itemType = movie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      toast({
        title: `${itemType} Removed`,
        description: `${movie.title} has been removed from your list.`,
      });
      onClose();
    });
  };

  const handleSaveSocialLink = () => {
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { socialLink: newSocialLink || null });
      toast({
        title: 'Link Updated',
        description: newSocialLink ? 'Social link has been updated.' : 'Social link has been removed.',
      });
    });
  };

  const handleRatingSave = async (rating: number) => {
    if (!user?.uid || !tmdbId) return;

    setIsSavingRating(true);
    try {
      const result = await createOrUpdateRating(
        user.uid,
        tmdbId,
        movie.mediaType || 'movie',
        movie.title,
        movie.posterUrl,
        rating
      );
      if (result.success) {
        setUserRating(rating);
        toast({ title: 'Rating saved', description: `You rated this ${rating.toFixed(1)}/10` });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save rating.' });
    } finally {
      setIsSavingRating(false);
    }
  };

  const handleRatingClear = async () => {
    if (!user?.uid || !tmdbId) return;

    setIsSavingRating(true);
    try {
      const result = await deleteRating(user.uid, tmdbId);
      if (result.success) {
        setUserRating(null);
        toast({ title: 'Rating removed' });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove rating.' });
    } finally {
      setIsSavingRating(false);
    }
  };

  const isAddedByCurrentUser = movie.addedBy === user?.uid;
  const displayUser = addedByUser || (isAddedByCurrentUser ? {
    photoURL: user?.photoURL,
    displayName: user?.displayName,
    email: user?.email,
    username: null,
  } : null);
  const displayName = displayUser?.displayName || displayUser?.username ||
    (displayUser as { email?: string })?.email?.split('@')[0] || 'Someone';

  return (
    <>
      {/* Main Movie Details Drawer */}
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
            <div className="px-6 pt-4 pb-4 border-b border-border flex-shrink-0">
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
            <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'info' ? 'overflow-y-auto' : 'overflow-hidden'}`}>
              {activeTab === 'info' ? (
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: Poster + Video */}
                    <div className="space-y-4">
                      <Image
                        src={movie.posterUrl}
                        alt={`Poster for ${movie.title}`}
                        width={400}
                        height={600}
                        className="rounded-lg border-[3px] border-black shadow-[4px_4px_0px_0px_#000] w-full h-auto"
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

                      <div className="text-sm text-muted-foreground">
                        Added by {displayName}
                      </div>
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

                      {/* Your Rating */}
                      <div className="pt-2 pb-2 border-y border-border">
                        <RatingSlider
                          value={userRating}
                          onChangeComplete={handleRatingSave}
                          onClear={handleRatingClear}
                          disabled={isSavingRating}
                          size="md"
                          label="Your Rating"
                        />
                      </div>

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

                      {/* Watch Status */}
                      {canEdit && (
                        <div className="pt-4 border-t">
                          <h3 className="font-bold mb-2">Status</h3>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleStatusChange('To Watch')}
                              variant={localStatus === 'To Watch' ? 'default' : 'outline'}
                              className={retroButtonClass}
                              disabled={isPending}
                            >
                              <EyeOff className="h-4 w-4 mr-2" />
                              To Watch
                            </Button>
                            <Button
                              onClick={() => handleStatusChange('Watched')}
                              variant={localStatus === 'Watched' ? 'default' : 'outline'}
                              className={retroButtonClass}
                              disabled={isPending}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Watched
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Edit Social Link */}
                      {canEdit && (
                        <div className="pt-4 border-t">
                          <h3 className="font-bold mb-2">Video Link</h3>
                          <div className="flex gap-2">
                            <Input
                              type="url"
                              value={newSocialLink}
                              onChange={(e) => setNewSocialLink(e.target.value)}
                              placeholder="TikTok, Instagram, or YouTube URL"
                              className={retroInputClass}
                            />
                            <Button
                              onClick={handleSaveSocialLink}
                              disabled={isPending || newSocialLink === (movie.socialLink || '')}
                              className={retroButtonClass}
                            >
                              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Remove button */}
                      {canEdit && (
                        <div className="pt-4 border-t">
                          <Button
                            variant="destructive"
                            onClick={handleRemove}
                            disabled={isPending}
                            className={`w-full ${retroButtonClass}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove from List
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <ReviewsList
                    tmdbId={tmdbId}
                    mediaType={movie.mediaType || 'movie'}
                    movieTitle={movie.title}
                    moviePosterUrl={movie.posterUrl}
                    currentUserId={user.uid}
                  />
                </div>
              )}
            </div>

            {/* Sticky bottom bar with Info/Reviews toggle */}
            <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setActiveTab('info')}
                  className={`flex-1 max-w-[150px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all ${
                    activeTab === 'info'
                      ? 'bg-primary text-primary-foreground shadow-[3px_3px_0px_0px_hsl(var(--border))]'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Info className="h-4 w-4" />
                  Info
                </button>
                <button
                  onClick={() => setActiveTab('reviews')}
                  className={`flex-1 max-w-[150px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-full font-medium transition-all ${
                    activeTab === 'reviews'
                      ? 'bg-primary text-primary-foreground shadow-[3px_3px_0px_0px_hsl(var(--border))]'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <MessageSquare className="h-4 w-4" />
                  Reviews
                </button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Rate on Watch Drawer */}
      <Drawer.Root open={showRateOnWatchModal} onOpenChange={(open) => !open && setShowRateOnWatchModal(false)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-background border-[3px] border-black border-b-0 outline-none">
            {/* Drag handle */}
            <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/40" />

            <div className="p-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
              <Drawer.Close className="absolute right-4 top-4 p-1 rounded-full hover:bg-secondary transition-colors">
                <X className="h-5 w-5" />
              </Drawer.Close>

              <Drawer.Title className="text-xl font-semibold mb-1">How was it?</Drawer.Title>
              <p className="text-muted-foreground mb-6">
                Rate <span className="font-semibold text-foreground">{movie.title}</span>
              </p>

              <div className="space-y-4">
                <RatingSlider
                  value={rateModalRating}
                  onChangeComplete={setRateModalRating}
                  showClearButton={false}
                  size="md"
                  label=""
                />
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Add a comment (optional)
                  </label>
                  <textarea
                    value={rateModalComment}
                    onChange={(e) => setRateModalComment(e.target.value)}
                    placeholder="Share your thoughts..."
                    rows={3}
                    maxLength={500}
                    className="w-full resize-none rounded-lg border-2 border-border bg-secondary/50 px-4 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      handleRateOnWatchSkip();
                      setShowRateOnWatchModal(false);
                    }}
                  >
                    Skip
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={async () => {
                      await handleRateOnWatchSave(rateModalRating, rateModalComment);
                      setShowRateOnWatchModal(false);
                      setRateModalRating(7);
                      setRateModalComment('');
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
