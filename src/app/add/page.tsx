'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Search, Loader2, Plus, Instagram, Youtube, Film, Tv, Check, List, Users, ChevronDown } from 'lucide-react';
import { TiktokIcon } from '@/components/icons';
import { parseVideoUrl, getProviderDisplayName } from '@/lib/video-utils';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { SheetMenu, SheetMenuItem, SheetMenuLabel } from '@/components/ui/sheet-menu';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import type { CollaborativeListSummary } from '@/lib/lists-server';
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
        const result = await apiCall<{ lists: CollaborativeListSummary[] }>(
          'GET', '/api/v1/me/collaborative-lists',
        );
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

  const handleAddMovie = async (_formData: FormData) => {
    if (!selectedMovie || !user || !selectedListId || !selectedListOwnerId) return;

    startAddingTransition(async () => {
      const itemType = selectedMovie.mediaType === 'tv' ? 'TV Show' : 'Movie';
      try {
        await apiCall(
          'POST',
          `/api/v1/lists/${selectedListOwnerId}/${selectedListId}/movies`,
          {
            movieData: selectedMovie,
            socialLink: socialLink || undefined,
          },
        );
        toast({
          title: `${itemType} Added!`,
          description: `${selectedMovie.title} has been added to your list.`,
        });
        setSelectedMovie(null);
        setSocialLink('');
      } catch (err) {
        toast({
          variant: 'destructive',
          title: `Error adding ${itemType.toLowerCase()}`,
          description: err instanceof ApiClientError ? err.message : 'Failed to add movie.',
        });
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <img src="/brand/cinechrony-icon.png" alt="Loading" className="h-12 w-12 animate-pulse" />
      </div>
    );
  }

  const selectTrigger = 'h-12 w-full rounded-[14px] border border-hair bg-sunken px-3.5 font-ui text-[15px] text-foreground';

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-background pb-28 text-foreground">
      <div className="mx-auto w-full max-w-2xl px-5 pt-2">
        {/* Header */}
        <header className="mb-7 pt-safe">
          <div className="mb-5 flex items-center justify-end gap-2 pt-2">
            <ThemeToggle variant="default" />
            <UserAvatar />
          </div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">the search</div>
          <h1
            className="mt-2 font-headline text-[38px] font-bold lowercase leading-[0.98] tracking-[-0.03em]"
            style={{ fontVariationSettings: '"wdth" 95' }}
          >
            find a film
          </h1>
          <p className="mt-2 font-serif text-[15px] font-light italic text-muted-foreground">
            search films, tv series, genres — and add the clip that sold you on it.
          </p>
        </header>

        {/* List Selector */}
        {!selectedMovie && (
          <div className="mb-5">
            <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">add to list</label>
            <SheetMenu
              title="add to list"
              trigger={(open) => (
                <button type="button" onClick={open} className={`${selectTrigger} flex items-center justify-between`}>
                  <span className={selectedListId ? '' : 'text-muted-foreground'}>
                    {allLists.find((l) => l.id === selectedListId)?.name ?? 'select a list'}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </button>
              )}
            >
              {(close) =>
                (isLoadingLists || isLoadingCollab) ? (
                  <SheetMenuItem disabled onSelect={() => {}}>loading lists…</SheetMenuItem>
                ) : allLists.length > 0 ? (
                  <>
                    {lists && lists.length > 0 && (
                      <>
                        <SheetMenuLabel>my lists</SheetMenuLabel>
                        {lists.map((list) => (
                          <SheetMenuItem
                            key={list.id}
                            icon={List}
                            active={selectedListId === list.id}
                            onSelect={() => { handleListChange(list.id); close(); }}
                          >
                            {list.name}{list.isDefault ? ' · default' : ''}
                          </SheetMenuItem>
                        ))}
                      </>
                    )}
                    {collaborativeLists.length > 0 && (
                      <>
                        <SheetMenuLabel>shared lists</SheetMenuLabel>
                        {collaborativeLists.map((list) => (
                          <SheetMenuItem
                            key={`collab-${list.id}`}
                            icon={Users}
                            active={selectedListId === list.id}
                            onSelect={() => { handleListChange(list.id); close(); }}
                          >
                            {list.name}{list.ownerUsername ? ` · by @${list.ownerUsername}` : ''}
                          </SheetMenuItem>
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <SheetMenuItem disabled onSelect={() => {}}>no lists found</SheetMenuItem>
                )
              }
            </SheetMenu>
          </div>
        )}

        {/* Search */}
        {!selectedMovie ? (
          <div>
            <div className="relative">
              <input
                type="text"
                placeholder="films, tv series, genres…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isAdding}
                className="h-12 w-full rounded-[14px] border border-hair bg-sunken pl-3.5 pr-11 font-ui text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5">
                {isSearching ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin text-muted-foreground" />
                ) : (
                  <Search className="h-[18px] w-[18px] text-muted-foreground" />
                )}
              </div>
            </div>

            {results.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  matching your search · {results.length}
                </div>
                <div className="max-h-[60vh] divide-y divide-hair overflow-y-auto">
                  {results.map((movie) => (
                    <button
                      key={`${movie.mediaType}-${movie.id}`}
                      onClick={() => { haptic('light'); handleSelectMovie(movie); }}
                      className="flex w-full items-center gap-3 py-3 text-left transition-opacity active:opacity-60"
                    >
                      <Image
                        src={movie.posterUrl}
                        alt={movie.title}
                        width={48}
                        height={72}
                        className="shrink-0 rounded-[10px] border border-hair object-cover"
                        data-ai-hint={movie.posterHint}
                      />
                      <div className="min-w-0 flex-grow">
                        <p className="truncate font-headline text-[16px] font-bold lowercase tracking-[-0.01em]">{movie.title}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {movie.year} · {movie.mediaType === 'tv' ? 'tv series' : 'film'}
                        </p>
                      </div>
                      <span className="shrink-0 text-muted-foreground">
                        {movie.mediaType === 'movie' ? <Film className="h-[18px] w-[18px]" strokeWidth={1.6} /> : <Tv className="h-[18px] w-[18px]" strokeWidth={1.6} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {query && !isSearching && results.length === 0 && (
              <p className="py-8 text-center font-serif italic text-muted-foreground">couldn&apos;t find that one. try another title?</p>
            )}
          </div>
        ) : (
          /* Selected film form */
          <form action={handleAddMovie} className="space-y-6">
            <div className="flex items-start gap-4">
              <Image
                src={selectedMovie.posterUrl}
                alt={selectedMovie.title}
                width={104}
                height={156}
                className="shrink-0 rounded-[12px] border border-hair shadow-lift"
                data-ai-hint={selectedMovie.posterHint}
              />
              <div className="min-w-0 flex-grow">
                <h3
                  className="font-headline text-[22px] font-bold lowercase leading-tight tracking-[-0.02em]"
                  style={{ fontVariationSettings: '"wdth" 95' }}
                >
                  {selectedMovie.title}
                </h3>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {selectedMovie.year} · {selectedMovie.mediaType === 'tv' ? 'tv series' : 'film'}
                </p>

                <div className="mt-4">
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">adding to</label>
                  <SheetMenu
                    title="adding to"
                    trigger={(open) => (
                      <button type="button" onClick={open} className={`${selectTrigger} flex items-center justify-between`}>
                        <span className="flex items-center gap-2 font-semibold">
                          {allLists.find(l => l.id === selectedListId)?.isCollaborative ? <Users className="h-4 w-4" /> : <List className="h-4 w-4" />}
                          {allLists.find(l => l.id === selectedListId)?.name || 'select a list'}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        {lists && lists.length > 0 && (
                          <>
                            <SheetMenuLabel>my lists</SheetMenuLabel>
                            {lists.map((list) => (
                              <SheetMenuItem
                                key={list.id}
                                icon={List}
                                active={selectedListId === list.id}
                                onSelect={() => { handleListChange(list.id); close(); }}
                              >
                                {list.name}{list.isDefault ? ' · default' : ''}
                              </SheetMenuItem>
                            ))}
                          </>
                        )}
                        {collaborativeLists.length > 0 && (
                          <>
                            <SheetMenuLabel>shared lists</SheetMenuLabel>
                            {collaborativeLists.map((list) => (
                              <SheetMenuItem
                                key={`collab-confirm-${list.id}`}
                                icon={Users}
                                active={selectedListId === list.id}
                                onSelect={() => { handleListChange(list.id); close(); }}
                              >
                                {list.name}{list.ownerUsername ? ` · by @${list.ownerUsername}` : ''}
                              </SheetMenuItem>
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </SheetMenu>
                </div>
              </div>
            </div>

            {/* Social link */}
            <div className="space-y-2">
              <label className="block font-ui text-[14px] font-semibold text-foreground">what made you want to watch this?</label>
              <p className="font-ui text-[12px] text-muted-foreground">saw a cool edit or trailer? paste the link so others can see what got you hyped.</p>
              <div className="relative">
                <input
                  type="url"
                  name="socialLink"
                  value={socialLink}
                  onChange={(e) => setSocialLink(e.target.value)}
                  placeholder="paste tiktok, reel, or youtube short…"
                  className={`h-12 w-full rounded-[14px] border border-hair bg-sunken pl-3.5 font-ui text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60 ${parsedVideo?.provider ? 'pr-11' : 'pr-3.5'}`}
                />
                {parsedVideo?.provider && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3.5">{getProviderIcon()}</div>
                )}
              </div>
              {parsedVideo?.provider ? (
                <p className="flex items-center gap-1 font-ui text-[12px] text-success">
                  <Check className="h-3.5 w-3.5" />
                  <span>{getProviderDisplayName(parsedVideo.provider)} video will be embedded</span>
                </p>
              ) : (
                <div className="flex items-center gap-2 font-ui text-[12px] text-muted-foreground">
                  <TiktokIcon className="h-3.5 w-3.5" />
                  <Instagram className="h-3.5 w-3.5" />
                  <Youtube className="h-3.5 w-3.5" />
                  <span>works with tiktok, reels, youtube shorts</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSelectedMovie(null); setSocialLink(''); }}
                className="h-[52px] flex-1 rounded-full border border-hair bg-card font-ui text-[15px] font-semibold text-foreground shadow-press transition-all active:scale-[0.98]"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={isAdding}
                className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-primary font-ui text-[15px] font-semibold text-primary-foreground shadow-fab transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-[18px] w-[18px]" /> add to list</>}
              </button>
            </div>
          </form>
        )}
      </div>

    </main>
  );
}
