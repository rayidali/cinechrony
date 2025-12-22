'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Search, Loader2, Plus, Instagram, Youtube, Film, Tv, Check, List } from 'lucide-react';
import { TiktokIcon } from '@/components/icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { BottomNav } from '@/components/bottom-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { addMovieToList } from '@/app/actions';
import { collection, orderBy, query as firestoreQuery } from 'firebase/firestore';
import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult, MovieList } from '@/lib/types';

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

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function AddPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [socialLink, setSocialLink] = useState('');
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();

  // Get user's lists
  const listsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return firestoreQuery(
      collection(firestore, 'users', user.uid, 'lists'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, user]);

  const { data: lists, isLoading: isLoadingLists } = useCollection<MovieList>(listsQuery);

  // Set default list when lists load
  useEffect(() => {
    if (lists && lists.length > 0 && !selectedListId) {
      const defaultList = lists.find(l => l.isDefault) || lists[0];
      setSelectedListId(defaultList.id);
    }
  }, [lists, selectedListId]);

  // Parse the social link to show provider icon
  const parsedVideo = parseVideoUrl(socialLink);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    if (!query.trim() || selectedMovie) {
      setResults([]);
      return;
    }

    const searchTimer = setTimeout(() => {
      startSearchTransition(async () => {
        const searchResults = mediaType === 'movie'
          ? await searchMovies(query)
          : await searchTVShows(query);
        setResults(searchResults);
      });
    }, 300);

    return () => clearTimeout(searchTimer);
  }, [query, selectedMovie, mediaType]);

  const handleSelectMovie = (movie: SearchResult) => {
    setSelectedMovie(movie);
    setResults([]);
    setQuery('');
  };

  const handleAddMovie = async (formData: FormData) => {
    if (!selectedMovie || !user || !selectedListId) return;

    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', selectedListId);
    formData.append('listOwnerId', user.uid);
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
          description: `${selectedMovie.title} has been added to your list.`,
        });
        setSelectedMovie(null);
        setSocialLink('');
      }
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

  const handleMediaTypeChange = (value: string) => {
    setMediaType(value as 'movie' | 'tv');
    setResults([]);
    setQuery('');
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary p-2 rounded-xl border-[3px] border-border shadow-[3px_3px_0px_0px_hsl(var(--border))]">
                <Plus className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl md:text-3xl font-headline font-bold">Add to List</h1>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
          <p className="text-muted-foreground">
            Search for movies or TV shows to add to your watchlist.
          </p>
        </header>

        <div className="max-w-2xl mx-auto">
          {/* List Selector */}
          {!selectedMovie && (
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">Add to list:</label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger className={`${retroInputClass} w-full`}>
                  <SelectValue placeholder="Select a list" />
                </SelectTrigger>
                <SelectContent className="border-[3px] border-border rounded-xl">
                  {isLoadingLists ? (
                    <SelectItem value="loading" disabled>Loading lists...</SelectItem>
                  ) : lists && lists.length > 0 ? (
                    lists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        <div className="flex items-center gap-2">
                          <List className="h-4 w-4" />
                          {list.name}
                          {list.isDefault && (
                            <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full ml-1">
                              Default
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>No lists found</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Search Section */}
          {!selectedMovie ? (
            <Card className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] bg-card">
              <CardContent className="p-6 space-y-4">
                {/* Media Type Toggle */}
                <Tabs value={mediaType} onValueChange={handleMediaTypeChange} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-background border-[3px] border-border rounded-full p-0 h-auto">
                    <TabsTrigger
                      value="movie"
                      className="rounded-l-full flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      <Film className="h-4 w-4" />
                      Movies
                    </TabsTrigger>
                    <TabsTrigger
                      value="tv"
                      className="rounded-r-full flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      <Tv className="h-4 w-4" />
                      TV Shows
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* Search Input */}
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={mediaType === 'movie' ? "Search for a movie..." : "Search for a TV show..."}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className={`${retroInputClass} pr-10 text-lg`}
                    disabled={isAdding}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                    {isSearching ? (
                      <Loader2 className="animate-spin text-muted-foreground" />
                    ) : (
                      <Search className="text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Search Results */}
                {results.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto p-2 bg-background rounded-2xl border-[3px] border-border">
                    {results.map((movie) => (
                      <button
                        key={movie.id}
                        onClick={() => handleSelectMovie(movie)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-4 border-[2px] border-transparent hover:border-border"
                      >
                        <Image
                          src={movie.posterUrl}
                          alt={movie.title}
                          width={50}
                          height={75}
                          className="rounded-lg border-[2px] border-border"
                          data-ai-hint={movie.posterHint}
                        />
                        <div>
                          <p className="font-bold text-lg">{movie.title}</p>
                          <p className="text-sm text-muted-foreground">{movie.year}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {query && !isSearching && results.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No results found for &quot;{query}&quot;
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            /* Selected Movie Form */
            <Card className="border-[3px] border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] bg-card">
              <CardContent className="p-6">
                <form action={handleAddMovie} className="space-y-6">
                  <div className="flex gap-6 items-start">
                    <Image
                      src={selectedMovie.posterUrl}
                      alt={selectedMovie.title}
                      width={120}
                      height={180}
                      className="rounded-xl border-[3px] border-border shadow-[4px_4px_0px_0px_hsl(var(--border))]"
                      data-ai-hint={selectedMovie.posterHint}
                    />
                    <div className="flex-grow">
                      <h3 className="text-2xl font-bold font-headline">{selectedMovie.title}</h3>
                      <p className="text-muted-foreground text-lg">{selectedMovie.year}</p>
                      <p className="text-sm text-primary mt-1 capitalize">{selectedMovie.mediaType}</p>

                      {/* Selected List */}
                      <div className="mt-4 p-3 bg-secondary rounded-xl border-[2px] border-border">
                        <p className="text-sm text-muted-foreground">Adding to:</p>
                        <p className="font-bold flex items-center gap-2">
                          <List className="h-4 w-4" />
                          {lists?.find(l => l.id === selectedListId)?.name || 'Unknown list'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Social Link Input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      What made you want to watch this?
                    </label>
                    <p className="text-xs text-muted-foreground">
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
                        <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                          {getProviderIcon()}
                        </div>
                      )}
                    </div>
                    {parsedVideo?.provider && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>{getProviderDisplayName(parsedVideo.provider)} video will be embedded!</span>
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

                  {/* Action Buttons */}
                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setSelectedMovie(null); setSocialLink(''); }}
                      className="border-[3px] border-border rounded-full font-bold"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className={`${retroButtonClass} bg-primary text-primary-foreground font-bold`}
                      disabled={isAdding}
                    >
                      {isAdding ? (
                        <Loader2 className="animate-spin h-4 w-4" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Add to List
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
