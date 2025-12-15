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
  Pencil,
  X,
} from 'lucide-react';

import type { Movie, TMDBMovieDetails, TMDBCast, UserProfile } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';
import { getUserProfile } from '@/app/actions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_API_KEY = 'fc5ca6d0';

type ExtendedMovieDetails = TMDBMovieDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

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
  const [movieDetails, setMovieDetails] = useState<ExtendedMovieDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [newSocialLink, setNewSocialLink] = useState('');
  const [addedByUser, setAddedByUser] = useState<UserProfile | null>(null);
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  // Reset state when movie changes
  useEffect(() => {
    if (movie) {
      setNewSocialLink(movie.socialLink || '');
      setMovieDetails(null);
      setAddedByUser(null);
    }
  }, [movie?.id]);

  // Fetch movie details when modal opens
  useEffect(() => {
    async function loadDetails() {
      if (!movie || !isOpen || movieDetails || isLoadingDetails) return;

      setIsLoadingDetails(true);
      let tmdbId = movie.tmdbId || parseInt(movie.id, 10);
      if (!isNaN(tmdbId)) {
        const details = await fetchMovieDetails(tmdbId);
        setMovieDetails(details);
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

  const handleToggle = () => {
    startTransition(() => {
      const newStatus = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
      updateDocumentNonBlocking(movieDocRef, { status: newStatus });
    });
  };

  const handleRemove = () => {
    startTransition(() => {
      deleteDocumentNonBlocking(movieDocRef);
      toast({
        title: 'Movie Removed',
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-headline flex items-center gap-2">
            {movie.title}
            <span className="text-muted-foreground font-normal text-lg">({movie.year})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
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

            {/* Added by info */}
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
            ) : movieDetails?.imdbRating && movieDetails.imdbRating !== 'N/A' ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-[#F5C518] text-black px-3 py-1.5 rounded-lg font-bold">
                  <IMDbLogo className="h-5 w-auto" />
                  <span className="text-lg">{movieDetails.imdbRating}</span>
                  <span className="text-sm font-normal">/10</span>
                </div>
                {movieDetails.imdbVotes && (
                  <span className="text-sm text-muted-foreground">
                    ({movieDetails.imdbVotes} votes)
                  </span>
                )}
              </div>
            ) : null}

            {/* Runtime & Genres */}
            {movieDetails && (
              <div className="flex flex-wrap gap-2">
                {movieDetails.runtime && (
                  <span className="bg-secondary px-2 py-1 rounded text-sm">
                    {Math.floor(movieDetails.runtime / 60)}h {movieDetails.runtime % 60}m
                  </span>
                )}
                {movieDetails.genres?.map((genre) => (
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
              ) : movieDetails?.overview || movie.overview ? (
                <p className="text-muted-foreground leading-relaxed">
                  {movieDetails?.overview || movie.overview}
                </p>
              ) : (
                <p className="text-muted-foreground italic">No overview available</p>
              )}
            </div>

            {/* Cast */}
            {movieDetails?.credits?.cast && movieDetails.credits.cast.length > 0 && (
              <div>
                <h3 className="font-bold mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Cast
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {movieDetails.credits.cast.slice(0, 6).map((actor: TMDBCast) => (
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
            {movieDetails?.imdbId && (
              <Button asChild variant="outline" className="w-full">
                <Link
                  href={`https://www.imdb.com/title/${movieDetails.imdbId}`}
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
                    onClick={() => {
                      if (movie.status !== 'To Watch') handleToggle();
                    }}
                    variant={movie.status === 'To Watch' ? 'default' : 'outline'}
                    className={retroButtonClass}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    To Watch
                  </Button>
                  <Button
                    onClick={() => {
                      if (movie.status !== 'Watched') handleToggle();
                    }}
                    variant={movie.status === 'Watched' ? 'default' : 'outline'}
                    className={retroButtonClass}
                  >
                    <EyeOff className="h-4 w-4 mr-2" />
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
      </DialogContent>
    </Dialog>
  );
}
