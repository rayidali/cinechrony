'use client';

import { useState, useTransition, useEffect } from 'react';
import { Search, Loader2, Plus, Instagram, Youtube } from 'lucide-react';
import Image from 'next/image';
import { TiktokIcon } from './icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';

import type { SearchResult, TMDBSearchResult } from '@/lib/types';
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

function formatTMDBSearchResult(result: TMDBSearchResult): SearchResult {
  const year = result.release_date ? result.release_date.split('-')[0] : 'N/A';
  return {
    id: result.id.toString(),
    title: result.title,
    year: year,
    posterUrl: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : 'https://picsum.photos/seed/placeholder/500/750',
    posterHint: 'movie poster',
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
    return data.results.slice(0, 10).map(formatTMDBSearchResult);
  }

  return [];
}

const retroInputClass =
  "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";
const retroButtonClass =
  "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

interface AddMovieFormForListProps {
  listId: string;
}

export function AddMovieFormForList({ listId }: AddMovieFormForListProps) {
  const { user } = useUser();
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
        const searchResults = await searchMovies(query);
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
    if (!selectedMovie || !user) return;

    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', listId);
    if (socialLink) {
      formData.set('socialLink', socialLink);
    }

    startAddingTransition(async () => {
      const result = await addMovieToList(formData);
      if (result?.error) {
        toast({
          variant: 'destructive',
          title: 'Error adding movie',
          description: result.error,
        });
      } else {
        toast({
          title: 'Movie Added!',
          description: `${selectedMovie.title} has been added to your list.`,
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
    <Card className="w-full max-w-2xl bg-secondary rounded-xl border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Add a New Film</CardTitle>
      </CardHeader>
      <CardContent>
        {!selectedMovie ? (
          <div className="space-y-4">
            <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
              <div className="relative w-full">
                <Input
                  type="text"
                  placeholder="Search for a movie (e.g., Star Wars)..."
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
                    key={movie.id}
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
                    <div>
                      <p className="font-bold">{movie.title}</p>
                      <p className="text-sm text-muted-foreground">{movie.year}</p>
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
                className="rounded-md border-[3px] border-black shadow-[4px_4px_0px_0px_#000]"
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
              <Button type="submit" className={retroButtonClass} disabled={isAdding}>
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
