'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Search, Loader2, Plus, Instagram, Youtube, Film, Tv, Check, List, Users } from 'lucide-react';
import { TiktokIcon } from '@/components/icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { BottomNav } from '@/components/bottom-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { addMovieToList, getCollaborativeLists } from '@/app/actions';
import { collection, orderBy, query as firestoreQuery } from 'firebase/firestore';
import type { SearchResult, TMDBSearchResult, TMDBTVSearchResult, MovieList } from '@/lib/types';

// Extended type for lists that includes owner info for collaborative lists
interface ListOption {
  id: string;
  name: string;
  isDefault?: boolean;
  ownerId: string;
  isCollaborative?: boolean;
  ownerUsername?: string;
}

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

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none dark:border-[2px] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:focus:shadow-none focus:translate-x-0.5 focus:translate-y-0.5 dark:focus:translate-x-0 dark:focus:translate-y-0 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none dark:border-[2px] active:shadow-none active:translate-x-1 active:translate-y-1 dark:active:translate-x-0 dark:active:translate-y-0 transition-all duration-200";

export default function AddPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [selectedListOwnerId, setSelectedListOwnerId] = useState<string>('');
  const [socialLink, setSocialLink] = useState('');
  const [collaborativeLists, setCollaborativeLists] = useState<ListOption[]>([]);
  const [isLoadingCollab, setIsLoadingCollab] = useState(false);

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

  // Fetch collaborative lists
  useEffect(() => {
    async function fetchCollaborativeLists() {
      if (!user) return;
      setIsLoadingCollab(true);
      try {
        const result = await getCollaborativeLists(user.uid);
        if (result.lists) {
          setCollaborativeLists(result.lists.map(l => ({
            id: l.id,
            name: l.name,
            ownerId: l.ownerId,
            isCollaborative: true,
            ownerUsername: l.ownerUsername || undefined,
          })));
        }
      } catch (error) {
        console.error('Failed to fetch collaborative lists:', error);
      } finally {
        setIsLoadingCollab(false);
      }
    }
    fetchCollaborativeLists();
  }, [user]);

  // Combine own lists and collaborative lists
  const allLists: ListOption[] = [
    ...(lists || []).map(l => ({
      id: l.id,
      name: l.name,
      isDefault: l.isDefault,
      ownerId: user?.uid || '',
      isCollaborative: false,
    })),
    ...collaborativeLists,
  ];

  // Set default list when lists load
  useEffect(() => {
    if (allLists.length > 0 && !selectedListId) {
      const defaultList = allLists.find(l => l.isDefault) || allLists[0];
      setSelectedListId(defaultList.id);
      setSelectedListOwnerId(defaultList.ownerId);
    }
  }, [lists, collaborativeLists, selectedListId]);

  // Handle list selection change
  const handleListChange = (listId: string) => {
    const selectedList = allLists.find(l => l.id === listId);
    if (selectedList) {
      setSelectedListId(listId);
      setSelectedListOwnerId(selectedList.ownerId);
    }
  };

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
    if (!selectedMovie || !user || !selectedListId || !selectedListOwnerId) return;

    formData.append('movieData', JSON.stringify(selectedMovie));
    formData.append('userId', user.uid);
    formData.append('listId', selectedListId);
    formData.append('listOwnerId', selectedListOwnerId);
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

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20 flex flex-col relative">
      <div className="container mx-auto p-4 md:p-8 flex-1 flex flex-col justify-center">
        {/* Header */}
        <header className="mb-8 text-center">
          <div className="flex justify-center items-center mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary p-2 rounded-xl border-[3px] dark:border-2 border-border shadow-[3px_3px_0px_0px_hsl(var(--border))] dark:shadow-none">
                <Plus className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl md:text-3xl font-headline font-bold">Add to List</h1>
            </div>
          </div>
          <p className="text-muted-foreground">
            Search for movies or TV shows to add to your watchlist.
          </p>
          {/* Theme toggle and avatar in top right corner */}
          <div className="absolute top-4 right-4 flex items-center gap-3">
            <ThemeToggle />
            <UserAvatar />
          </div>
        </header>

        <div className="max-w-2xl mx-auto w-full">
          {/* List Selector */}
          {!selectedMovie && (
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">Add to list:</label>
              <Select value={selectedListId} onValueChange={handleListChange}>
                <SelectTrigger className={`${retroInputClass} w-full`}>
                  <SelectValue placeholder="Select a list" />
                </SelectTrigger>
                <SelectContent className="border-[3px] border-border rounded-xl">
                  {(isLoadingLists || isLoadingCollab) ? (
                    <SelectItem value="loading" disabled>Loading lists...</SelectItem>
                  ) : allLists.length > 0 ? (
                    <>
                      {/* Own lists */}
                      {lists && lists.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">My Lists</div>
                          {lists.map((list) => (
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
                          ))}
                        </>
                      )}
                      {/* Collaborative lists */}
                      {collaborativeLists.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Shared Lists</div>
                          {collaborativeLists.map((list) => (
                            <SelectItem key={`collab-${list.id}`} value={list.id}>
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                {list.name}
                                {list.ownerUsername && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    by @{list.ownerUsername}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </>
                  ) : (
                    <SelectItem value="none" disabled>No lists found</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Search Section */}
          {!selectedMovie ? (
            <Card className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] dark:shadow-none bg-card">
              <CardContent className="p-6 space-y-4">
                {/* Search Input */}
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search for movies or TV shows..."
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
                        key={`${movie.mediaType}-${movie.id}`}
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
                        <div className="flex-grow">
                          <p className="font-bold text-lg">{movie.title}</p>
                          <p className="text-sm text-muted-foreground">{movie.year}</p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full border border-border">
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
            <Card className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[8px_8px_0px_0px_hsl(var(--border))] dark:shadow-none bg-card">
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

                      {/* Selected List - with dropdown to change */}
                      <div className="mt-4">
                        <label className="text-sm text-muted-foreground block mb-1">Adding to:</label>
                        <Select value={selectedListId} onValueChange={handleListChange}>
                          <SelectTrigger className="border-[2px] border-border rounded-xl bg-secondary h-auto py-2">
                            <SelectValue>
                              <span className="font-bold flex items-center gap-2">
                                {allLists.find(l => l.id === selectedListId)?.isCollaborative ? (
                                  <Users className="h-4 w-4" />
                                ) : (
                                  <List className="h-4 w-4" />
                                )}
                                {allLists.find(l => l.id === selectedListId)?.name || 'Select a list'}
                              </span>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="border-[3px] border-border rounded-xl">
                            {/* Own lists */}
                            {lists && lists.length > 0 && (
                              <>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">My Lists</div>
                                {lists.map((list) => (
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
                                ))}
                              </>
                            )}
                            {/* Collaborative lists */}
                            {collaborativeLists.length > 0 && (
                              <>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Shared Lists</div>
                                {collaborativeLists.map((list) => (
                                  <SelectItem key={`collab-confirm-${list.id}`} value={list.id}>
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      {list.name}
                                      {list.ownerUsername && (
                                        <span className="text-xs text-muted-foreground ml-1">
                                          by @{list.ownerUsername}
                                        </span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
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
