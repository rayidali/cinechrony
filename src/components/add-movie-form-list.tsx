'use client';

import { useState, useTransition, useEffect } from 'react';
import { Search, Loader2, Plus, Instagram, Youtube, Film, Tv } from 'lucide-react';
import Image from 'next/image';
import { TiktokIcon } from './icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';

import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult } from '@/lib/types';
import { addMovieToList } from '@/app/actions';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const accessToken = process.env.NEXT_PUBLIC_TMDB_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('TMDB Access Token is not configured.');
    return null;
  }

  const url = new URL(`${TMDB_API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  };

  try {
    const response = await fetch(url.toString(), options);
    if (!response.ok) {
      console.error(`TMDB API Error: ${response.status} ${response.statusText}`);
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('Failed to fetch from TMDB:', error);
    return null;
  }
}

function formatMovieSearchResult(result: TMDBSearchResult): SearchResult {
  const year = result.release_date ? result.release_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.title,
    year: year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750',
    posterHint: 'movie poster',
    mediaType: 'movie',
  };
}

function formatTVSearchResult(result: TMDBTVSearchResult): SearchResult {
  const year = result.first_air_date ? result.first_air_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.name,
    year: year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750',
    posterHint: 'tv show poster',
    mediaType: 'tv',
  };
}

async function searchMovies(query: string): Promise<SearchResult[]> {
  if (!query) return [];

  const data = await tmdbFetch('search/movie', {
    query: query,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  });

  if (data && data.results) {
    return data.results.slice(0, 10).map(formatMovieSearchResult);
  }

  return [];
}

async function searchTVShows(query: string): Promise<SearchResult[]> {
  if (!query) return [];

  const data = await tmdbFetch('search/tv', {
    query: query,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  });

  if (data && data.results) {
    return data.results.slice(0, 10).map(formatTVSearchResult);
  }

  return [];
}

async function searchAll(query: string): Promise<SearchResult[]> {
  if (!query) return [];

  // Search both movies and TV shows in parallel
  const [movies, tvShows] = await Promise.all([
    searchMovies(query),
    searchTVShows(query),
  ]);

  // Interleave results to show both types mixed together
  const combined: SearchResult[] = [];
  const maxLength = Math.max(movies.length, tvShows.length);

  for (let i = 0; i < maxLength; i++) {
    if (i < movies.length) combined.push(movies[i]);
    if (i < tvShows.length) combined.push(tvShows[i]);
  }

  // Limit to 12 results total
  return combined.slice(0, 12);
}

const retroInputClass =
  "border-[3px] dark:border-2 border-border rounded-lg shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:focus:shadow-none focus:translate-x-0.5 focus:translate-y-0.5 dark:focus:translate-x-0 dark:focus:translate-y-0 transition-all duration-200";
const retroButtonClass =
  "border-[3px] dark:border-2 border-border rounded-lg shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 dark:active:translate-x-0 dark:active:translate-y-0 transition-all duration-200";

interface AddMovieFormForListProps {
  listId: string;
  listOwnerId?: string; // Required for collaborative lists
}

export function AddMovieFormForList({ listId, listOwnerId }: AddMovieFormForListProps) {
  const { user } = useUser();
  // Use provided listOwnerId or default to current user (for user's own lists)
  const effectiveOwnerId = listOwnerId || user?.uid;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [socialLink, setSocialLink] = useState('');

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();

  const { toast } = useToast();

  // Parse the social link to show provider icon
  const parsedVideo = parseVideoUrl(socialLink);

  useEffect(() => {
    if (!query.trim() || selectedMovie) {
      setResults([]);
      return;
    }

    const searchTimer = setTimeout(() => {
      startSearchTransition(async () => {
        const searchResults = await searchAll(query);
        setResults(searchResults);
      });
    }, 300);

    return () => clearTimeout(searchTimer);
  }, [query, selectedMovie]);

  const handleSelectMovie = (movie: SearchResult) => {
    setSelectedMovie(movie);
    setResults([]);
    setQuery('');
  };

  const handleAddMovie = async (formData: FormData) => {
    if (!selectedMovie || !user || !effectiveOwnerId) return;

    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', listId);
    formData.append('listOwnerId', effectiveOwnerId); // For collaborative lists
    if (socialLink) {
      formData.set('socialLink', socialLink);
    }

    startAddingTransition(async () => {
      const result = await addMovieToList(formData);
      const itemType = selectedMovie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      if (result?.error) {
        toast({
          variant: 'destructive',
          title: `Error adding ${itemType.toLowerCase()}`,
          description: result.error,
        });
      } else {
        toast({
          title: `${itemType} Added!`,
          description: `${selectedMovie.title} has been added to the list.`,
        });
      }
      setSelectedMovie(null);
      setSocialLink('');
    });
  };

  const getProviderIcon = () => {
    if (!parsedVideo || !parsedVideo.provider) return null;
    switch (parsedVideo.provider) {
      case 'tiktok':
        return <TiktokIcon className="h-4 w-4 text-primary" />;
      case 'instagram':
        return <Instagram className="h-4 w-4 text-primary" />;
      case 'youtube':
        return <Youtube className="h-4 w-4 text-primary" />;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-2xl bg-secondary rounded-xl border-[3px] dark:border-2 border-border shadow-[8px_8px_0px_0px_hsl(var(--border))] dark:shadow-none">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Add to Watchlist</CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedMovie ? (
          <div className="space-y-4">
            <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
              <div className="relative w-full">
                <Input
                  type="text"
                  placeholder="Search for movies or TV shows..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className={`${retroInputClass} pr-10`}
                  disabled={isAdding}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  {isSearching ? (
                    <Loader2 className="animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="text-muted-foreground" />
                  )}
                </div>
              </div>
            </form>
            {results.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto p-2 bg-background rounded-lg border-[3px] border-black">
                {results.map((movie) => (
                  <button
                    key={`${movie.mediaType}-${movie.id}`}
                    onClick={() => handleSelectMovie(movie)}
                    className="w-full text-left p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-4"
                  >
                    <Image
                      src={movie.posterUrl}
                      alt={movie.title}
                      width={40}
                      height={60}
                      className="rounded-sm"
                      data-ai-hint={movie.posterHint}
                    />
                    <div className="flex-grow">
                      <p className="font-bold">{movie.title}</p>
                      <p className="text-sm text-muted-foreground">{movie.year}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full border border-black">
                      {movie.mediaType === 'movie' ? (
                        <>
                          <Film className="h-3 w-3" />
                          <span>Movie</span>
                        </>
                      ) : (
                        <>
                          <Tv className="h-3 w-3" />
                          <span>TV</span>
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form action={handleAddMovie} className="space-y-4">
            <div className="flex gap-4 items-start">
              <Image
                src={selectedMovie.posterUrl}
                alt={selectedMovie.title}
                width={80}
                height={120}
                className="rounded-md border-[3px] dark:border-2 border-border shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none"
                data-ai-hint={selectedMovie.posterHint}
              />
              <div className="flex-grow">
                <h3 className="text-xl font-bold font-headline">{selectedMovie.title}</h3>
                <p className="text-muted-foreground">{selectedMovie.year}</p>
                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    What made you want to watch this?
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Saw a cool edit or trailer? Paste the link so others can see what got you hyped!
                  </p>
                  <div className="relative">
                    <Input
                      type="url"
                      name="socialLink"
                      value={socialLink}
                      onChange={(e) => setSocialLink(e.target.value)}
                      placeholder="Paste TikTok, Reel, or YouTube Short link..."
                      className={`${retroInputClass} ${parsedVideo?.provider ? 'pr-10' : ''}`}
                    />
                    {parsedVideo?.provider && (
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                        {getProviderIcon()}
                      </div>
                    )}
                  </div>
                  {parsedVideo?.provider && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      {getProviderIcon()}
                      <span>{getProviderDisplayName(parsedVideo.provider)} video will be embedded in the movie card!</span>
                    </p>
                  )}
                  {!parsedVideo?.provider && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <TiktokIcon className="h-3 w-3" />
                      <Instagram className="h-3 w-3" />
                      <Youtube className="h-3 w-3" />
                      <span>Works with TikTok, Instagram Reels, YouTube Shorts</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setSelectedMovie(null); setSocialLink(''); }} className="font-bold">
                Cancel
              </Button>
              <Button type="submit" className={`${retroButtonClass} bg-warning text-warning-foreground hover:bg-warning/90`} disabled={isAdding}>
                {isAdding ? <Loader2 className="animate-spin" /> : <Plus />}
                Add to List
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
