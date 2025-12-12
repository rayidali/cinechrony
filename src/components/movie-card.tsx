'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Instagram,
  Loader2,
  Trash2,
  Youtube,
  Pencil,
  X,
  ExternalLink,
  Maximize2,
  Users
} from 'lucide-react';

import type { Movie, TMDBMovieDetails, TMDBCast } from '@/lib/types';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TiktokIcon } from './icons';
import { VideoEmbed } from './video-embed';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';

type MovieCardProps = {
  movie: Movie;
  listId?: string;
  userAvatarUrl?: string;
};

// OMDB API response type
type OMDBResponse = {
  Title: string;
  Year: string;
  imdbRating: string;
  imdbVotes: string;
  imdbID: string;
  Response: string;
  Error?: string;
};

// Extended movie details with IMDB data
type ExtendedMovieDetails = TMDBMovieDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

const retroInputClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_API_KEY = 'fc5ca6d0';

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

// IMDB Logo component
function IMDbLogo({ className = "h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 32"
      className={className}
      fill="currentColor"
    >
      <rect width="64" height="32" rx="4" fill="#F5C518"/>
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

// Fetch movie details from TMDB (including external IDs for IMDB ID)
async function fetchMovieDetails(tmdbId: number): Promise<ExtendedMovieDetails | null> {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    // Fetch movie details with credits and external IDs
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

    // Extract IMDB ID from external_ids
    const imdbId = data.external_ids?.imdb_id;

    // If we have an IMDB ID, fetch the rating from OMDB
    if (imdbId) {
      const omdbData = await fetchOMDBRating(imdbId);
      if (omdbData) {
        return {
          ...data,
          imdbId,
          imdbRating: omdbData.imdbRating,
          imdbVotes: omdbData.imdbVotes,
        };
      }
    }

    return { ...data, imdbId };
  } catch {
    return null;
  }
}

// Fetch IMDB rating from OMDB API
async function fetchOMDBRating(imdbId: string): Promise<OMDBResponse | null> {
  try {
    const response = await fetch(
      `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`
    );
    if (!response.ok) return null;
    const data: OMDBResponse = await response.json();
    if (data.Response === 'True') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

// Search for movie by title and year to get TMDB ID
async function searchMovieByTitle(title: string, year: string): Promise<number | null> {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const response = await fetch(
      `${TMDB_API_BASE_URL}/search/movie?query=${encodeURIComponent(title)}&year=${year}`,
      {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].id;
    }
    return null;
  } catch {
    return null;
  }
}

export function MovieCard({ movie, listId, userAvatarUrl }: MovieCardProps) {
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditingSocialLink, setIsEditingSocialLink] = useState(false);
  const [newSocialLink, setNewSocialLink] = useState(movie.socialLink || '');
  const [movieDetails, setMovieDetails] = useState<ExtendedMovieDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  // Parse video URL to check if we have an embeddable video
  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  // Do not render if we don't have the necessary info
  if (!user) return null;

  // Build the correct document reference based on whether we have a listId
  const movieDocRef = listId
    ? doc(firestore, 'users', user.uid, 'lists', listId, 'movies', movie.id)
    : doc(firestore, 'users', user.uid, 'movies', movie.id);

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
    });
  };

  const handleSaveSocialLink = () => {
    startTransition(() => {
      updateDocumentNonBlocking(movieDocRef, { socialLink: newSocialLink || null });
      toast({
        title: 'Link Updated',
        description: newSocialLink ? 'Social link has been updated.' : 'Social link has been removed.',
      });
      setIsEditingSocialLink(false);
    });
  };

  const handleOpenModal = async () => {
    setIsModalOpen(true);

    // Fetch movie details if we don't have them yet
    if (!movieDetails && !isLoadingDetails) {
      setIsLoadingDetails(true);

      // Try to get TMDB ID from movie data or search by title
      let tmdbId = movie.tmdbId;
      if (!tmdbId) {
        // Movie ID from our system is the TMDB ID as string
        tmdbId = parseInt(movie.id, 10);
        if (isNaN(tmdbId)) {
          // Fallback: search by title
          tmdbId = await searchMovieByTitle(movie.title, movie.year) || undefined;
        }
      }

      if (tmdbId) {
        const details = await fetchMovieDetails(tmdbId);
        setMovieDetails(details);
      }
      setIsLoadingDetails(false);
    }
  };

  const handleExpandVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <>
      <Card className="flex flex-col border-[3px] border-black rounded-lg shadow-[8px_8px_0px_0px_#000] overflow-hidden transition-all duration-200 hover:shadow-[4px_4px_0px_0px_#000]">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border-[3px] border-black">
                <AvatarImage src={user?.photoURL || userAvatarUrl} alt={user?.displayName || 'user'} />
                <AvatarFallback>{user?.email?.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <p className="font-bold text-sm">Added by {user?.displayName || user?.email?.split('@')[0]}</p>
            </div>
            {/* Expand to modal button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenModal}
              className="h-8 w-8"
              title="View details"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          <CardTitle className="cursor-pointer hover:text-primary transition-colors" onClick={handleOpenModal}>
            {movie.title}
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <span>{movie.year}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-grow flex flex-col gap-4 p-6 pt-0">
          {/* Movie Poster - click to open modal */}
          <div
            className="relative cursor-pointer transition-all duration-300 group"
            onClick={handleOpenModal}
          >
            <Image
              src={movie.posterUrl}
              alt={`Poster for ${movie.title}`}
              width={500}
              height={750}
              className="rounded-md border-[3px] border-black object-cover w-full h-auto aspect-[2/3] shadow-[4px_4px_0px_0px_#000]"
              data-ai-hint={movie.posterHint}
            />

            {/* Overlay with "View Details" */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md">
              <div className="flex flex-col items-center gap-2 text-white">
                <Maximize2 className="h-8 w-8" />
                <span className="font-bold text-sm bg-black/50 px-3 py-1 rounded-full">
                  View Details
                </span>
              </div>
            </div>

            {/* Video badge */}
            {hasEmbeddableVideo && (
              <div className="absolute top-2 right-2">
                <div className="flex items-center gap-1 bg-black/80 text-white px-2 py-1 rounded-full text-xs font-bold">
                  {SocialIcon && <SocialIcon className="h-3 w-3" />}
                  <span>{getProviderDisplayName(parsedVideo?.provider || null)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Expandable Video Section - Dropdown */}
          {hasEmbeddableVideo && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExpandVideo}
                className="w-full flex items-center justify-center gap-2 border-[2px] border-black"
              >
                {SocialIcon && <SocialIcon className="h-4 w-4" />}
                <span className="font-bold">
                  {isExpanded ? 'Hide' : 'Watch'} {getProviderDisplayName(parsedVideo?.provider || null)} Video
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>

              {isExpanded && (
                <div className="animate-in slide-in-from-top-2 duration-300">
                  <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />
                </div>
              )}
            </>
          )}

          {/* Edit Social Link Section */}
          {isEditingSocialLink ? (
            <div className="flex gap-2">
              <Input
                type="url"
                value={newSocialLink}
                onChange={(e) => setNewSocialLink(e.target.value)}
                placeholder="TikTok, Instagram, or YouTube URL"
                className={retroInputClass}
              />
              <Button size="icon" onClick={handleSaveSocialLink} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓'}
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setIsEditingSocialLink(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingSocialLink(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3 mr-1" />
              {movie.socialLink ? 'Edit video link' : 'Add video link'}
            </Button>
          )}
        </CardContent>

        <CardFooter className="flex justify-between gap-2 bg-secondary p-4 border-t-[3px] border-black mt-auto">
          <form
            action={handleRemove}
            className="flex"
            onSubmit={(e) => {
              e.preventDefault();
              handleRemove();
            }}
          >
            <Button
              type="submit"
              variant="destructive"
              size="icon"
              className={retroButtonClass}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          </form>
          <div className="flex justify-end gap-2">
            {SocialIcon && movie.socialLink && (
              <Button
                asChild
                variant="outline"
                size="icon"
                className={retroButtonClass}
              >
                <Link
                  href={movie.socialLink}
                  target="_blank"
                  aria-label="Social media link"
                >
                  <SocialIcon className="h-5 w-5" />
                </Link>
              </Button>
            )}
            <form
              action={handleToggle}
              onSubmit={(e) => {
                e.preventDefault();
                handleToggle();
              }}
            >
              <Button
                type="submit"
                disabled={isPending}
                size="icon"
                className={`${retroButtonClass} w-auto px-4`}
                variant={movie.status === 'Watched' ? 'default' : 'secondary'}
              >
                {isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    {movie.status === 'To Watch' ? (
                      <Eye className="h-5 w-5" />
                    ) : (
                      <EyeOff className="h-5 w-5" />
                    )}
                    <span className="ml-2 font-bold">
                      {movie.status === 'Watched' ? 'Watched' : 'To Watch'}
                    </span>
                  </>
                )}
              </Button>
            </form>
          </div>
        </CardFooter>
      </Card>

      {/* Expanded Modal View */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
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

              {/* Video embed in modal */}
              {hasEmbeddableVideo && (
                <div>
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    {SocialIcon && <SocialIcon className="h-4 w-4" />}
                    {getProviderDisplayName(parsedVideo?.provider || null)} Video
                  </h3>
                  <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />
                </div>
              )}

              {/* External link to social */}
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
              ) : movieDetails ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <IMDbLogo className="h-4 w-auto opacity-50" />
                  <span>Rating not available</span>
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

              {/* Overview/Logline */}
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

              {/* Edit Social Link in Modal */}
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
                {parseVideoUrl(newSocialLink)?.provider && newSocialLink !== movie.socialLink && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <span className="text-green-600">✓</span>
                    {getProviderDisplayName(parseVideoUrl(newSocialLink)?.provider || null)} link detected
                  </p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
