'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Film,
  User,
  ArrowLeft,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp,
  Maximize2,
  ExternalLink,
  Users,
  Instagram,
  Youtube,
} from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FollowButton } from '@/components/follow-button';
import { VideoEmbed } from '@/components/video-embed';
import { TiktokIcon } from '@/components/icons';
import {
  getUserByUsername,
  getPublicListMovies,
} from '@/app/actions';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import type { UserProfile, Movie, MovieList } from '@/lib/types';
import type { TMDBMovieDetails, TMDBCast } from '@/lib/types';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_API_KEY = 'fc5ca6d0';

// Extended movie details with IMDB data
type ExtendedMovieDetails = TMDBMovieDetails & {
  imdbId?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

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
    <svg viewBox="0 0 64 32" className={className} fill="currentColor">
      <rect width="64" height="32" rx="4" fill="#F5C518"/>
      <text x="32" y="23" textAnchor="middle" fill="black" fontSize="18" fontWeight="bold" fontFamily="Arial, sans-serif">
        IMDb
      </text>
    </svg>
  );
}

// Fetch movie details from TMDB
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

// Read-only Movie Card for public viewing
function PublicMovieCard({ movie }: { movie: Movie }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [movieDetails, setMovieDetails] = useState<ExtendedMovieDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const parsedVideo = parseVideoUrl(movie.socialLink);
  const hasEmbeddableVideo = parsedVideo && parsedVideo.provider !== null;
  const SocialIcon = getProviderIcon(movie.socialLink);

  const handleOpenModal = async () => {
    setIsModalOpen(true);

    if (!movieDetails && !isLoadingDetails) {
      setIsLoadingDetails(true);
      let tmdbId = movie.tmdbId || parseInt(movie.id, 10);
      if (!isNaN(tmdbId)) {
        const details = await fetchMovieDetails(tmdbId);
        setMovieDetails(details);
      }
      setIsLoadingDetails(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col border-[3px] border-black rounded-lg shadow-[8px_8px_0px_0px_#000] overflow-hidden transition-all duration-200 md:hover:shadow-[4px_4px_0px_0px_#000]">
        <CardHeader>
          <CardTitle className="cursor-pointer hover:text-primary transition-colors" onClick={handleOpenModal}>
            {movie.title}
          </CardTitle>
          <CardDescription>{movie.year}</CardDescription>
        </CardHeader>

        <CardContent className="flex-grow flex flex-col gap-4 p-6 pt-0">
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
            />

            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 md:group-hover:opacity-100 transition-opacity rounded-md pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-white">
                <Maximize2 className="h-8 w-8" />
                <span className="font-bold text-sm bg-black/50 px-3 py-1 rounded-full">View Details</span>
              </div>
            </div>

            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 md:hidden pointer-events-none">
              <span className="text-xs font-bold text-white bg-black/70 px-3 py-1 rounded-full flex items-center gap-1">
                <Maximize2 className="h-3 w-3" />
                Tap to expand
              </span>
            </div>

            {hasEmbeddableVideo && (
              <div className="absolute top-2 right-2">
                <div className="flex items-center gap-1 bg-black/80 text-white px-2 py-1 rounded-full text-xs font-bold">
                  {SocialIcon && <SocialIcon className="h-3 w-3" />}
                  <span>{getProviderDisplayName(parsedVideo?.provider || null)}</span>
                </div>
              </div>
            )}
          </div>

          {hasEmbeddableVideo && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-center gap-2 border-[2px] border-black"
              >
                {SocialIcon && <SocialIcon className="h-4 w-4" />}
                <span className="font-bold">
                  {isExpanded ? 'Hide' : 'Watch'} {getProviderDisplayName(parsedVideo?.provider || null)} Video
                </span>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>

              {isExpanded && (
                <div className="animate-in slide-in-from-top-2 duration-300">
                  <VideoEmbed url={movie.socialLink} autoLoad={true} autoPlay={true} />
                </div>
              )}
            </>
          )}

          {/* Status Badge */}
          <div className="flex justify-center">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              movie.status === 'Watched'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}>
              {movie.status}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-headline flex items-center gap-2">
              {movie.title}
              <span className="text-muted-foreground font-normal text-lg">({movie.year})</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
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
            </div>

            <div className="space-y-4">
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
                    <span className="text-sm text-muted-foreground">({movieDetails.imdbVotes} votes)</span>
                  )}
                </div>
              ) : null}

              {movieDetails && (
                <div className="flex flex-wrap gap-2">
                  {movieDetails.runtime && (
                    <span className="bg-secondary px-2 py-1 rounded text-sm">
                      {Math.floor(movieDetails.runtime / 60)}h {movieDetails.runtime % 60}m
                    </span>
                  )}
                  {movieDetails.genres?.map((genre) => (
                    <span key={genre.id} className="bg-secondary px-2 py-1 rounded text-sm">{genre.name}</span>
                  ))}
                </div>
              )}

              <div>
                <h3 className="font-bold mb-2">Overview</h3>
                {isLoadingDetails ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading details...
                  </div>
                ) : movieDetails?.overview || movie.overview ? (
                  <p className="text-muted-foreground leading-relaxed">{movieDetails?.overview || movie.overview}</p>
                ) : (
                  <p className="text-muted-foreground italic">No overview available</p>
                )}
              </div>

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

              {movieDetails?.imdbId && (
                <Button asChild variant="outline" className="w-full">
                  <Link href={`https://www.imdb.com/title/${movieDetails.imdbId}`} target="_blank" rel="noopener noreferrer">
                    <IMDbLogo className="h-4 w-auto mr-2" />
                    View on IMDb
                  </Link>
                </Button>
              )}

              <div className="pt-4 border-t">
                <h3 className="font-bold mb-2">Status</h3>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                  movie.status === 'Watched'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {movie.status}
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PublicListPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const params = useParams();
  const username = params.username as string;
  const listId = params.listId as string;

  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [list, setList] = useState<MovieList | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');

  useEffect(() => {
    async function loadList() {
      setIsLoading(true);
      setError(null);

      try {
        // Get owner profile
        const profileResult = await getUserByUsername(username);
        if (profileResult.error || !profileResult.user) {
          setError('User not found');
          setIsLoading(false);
          return;
        }

        setOwner(profileResult.user);

        // Redirect to own list page if viewing own list
        if (user && profileResult.user.uid === user.uid) {
          router.replace(`/lists/${listId}`);
          return;
        }

        // Get list and movies
        const viewerId = user?.uid || '';
        const listResult = await getPublicListMovies(profileResult.user.uid, listId, viewerId);

        if (listResult.error) {
          setError(listResult.error);
          setIsLoading(false);
          return;
        }

        setList(listResult.list as MovieList);
        setMovies(listResult.movies as Movie[]);
      } catch (err) {
        console.error('Failed to load list:', err);
        setError('Failed to load list');
      } finally {
        setIsLoading(false);
      }
    }

    if (username && listId) {
      loadList();
    }
  }, [username, listId, user, router]);

  const filteredMovies = movies.filter((movie) => movie.status === filter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <div className="container mx-auto p-4 md:p-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Lock className="h-16 w-16 text-muted-foreground mb-4" />
            <h1 className="text-2xl font-headline font-bold mb-2">
              {error === 'This list is private.' ? 'Private List' : 'List Not Found'}
            </h1>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => router.back()}>Go Back</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8">
          <div className="w-full flex justify-between items-center mb-6">
            <Button variant="ghost" className="gap-2" onClick={() => router.replace(`/profile/${username}`)}>
              <ArrowLeft className="h-4 w-4" />
              Back to Profile
            </Button>
          </div>

          {/* List Header */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 mb-4">
              <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
              <h1 className="text-3xl md:text-5xl font-headline font-bold text-center tracking-tighter">
                {list?.name || 'List'}
              </h1>
            </div>

            {/* Owner Info */}
            {owner && (
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 border-[2px] border-black flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Link href={`/profile/${owner.username}`} className="font-medium hover:text-primary transition-colors">
                    {owner.displayName || owner.username}
                  </Link>
                  <p className="text-sm text-muted-foreground">@{owner.username}</p>
                </div>
                {!isUserLoading && user && (
                  <FollowButton
                    targetUserId={owner.uid}
                    targetUsername={owner.username || ''}
                    size="sm"
                  />
                )}
              </div>
            )}

            <p className="text-muted-foreground text-center">
              Viewing {owner?.displayName || owner?.username}&apos;s list (read-only)
            </p>
          </div>
        </header>

        {/* Filter Tabs */}
        <div className="flex justify-center mb-8">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as 'To Watch' | 'Watched')} className="w-full max-w-xs">
            <TabsList className="grid w-full grid-cols-2 bg-background border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] p-0 h-auto">
              <TabsTrigger
                value="To Watch"
                className="rounded-l-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none border-r-[3px] border-black"
              >
                To Watch
              </TabsTrigger>
              <TabsTrigger
                value="Watched"
                className="rounded-r-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                Watched
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Movies Grid */}
        {filteredMovies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {filteredMovies.map((movie) => (
              <PublicMovieCard key={movie.id} movie={movie} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-[3px] border-dashed border-black rounded-lg bg-secondary">
            <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-headline text-2xl font-bold">No movies here</h3>
            <p className="text-muted-foreground mt-2">
              There are no movies in the &apos;{filter}&apos; list.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
